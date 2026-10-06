import { randomBytes } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { CloudFrontClient, CloudFrontServiceException, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { DeleteObjectsCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

// Videos live in a private S3 bucket and are served through CloudFront (see scripts/aws-setup.sh).
// No transcoding: the MP4 Krec produces already plays in every browser, so a link works the
// moment the upload finishes.

export interface AwsConfig {
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  cdnDomain: string // e.g. d1234abcd.cloudfront.net
  distributionId: string
}

const CODE_PREFIX = 'krec1:'

/** Parses the one-line setup code printed by scripts/aws-setup.sh. */
export function parseSetupCode(code: string): AwsConfig {
  const trimmed = code.trim()
  if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('That is not a Krec setup code. It starts with "krec1:".')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(Buffer.from(trimmed.slice(CODE_PREFIX.length), 'base64').toString('utf8'))
  } catch {
    throw new Error('The setup code is incomplete. Copy the whole line again.')
  }
  const field = (name: string): string => {
    const value = raw[name]
    if (typeof value !== 'string' || value === '') throw new Error(`The setup code is missing "${name}".`)
    return value
  }
  return {
    region: field('region'),
    bucket: field('bucket'),
    accessKeyId: field('accessKeyId'),
    secretAccessKey: field('secretAccessKey'),
    cdnDomain: field('cdnDomain'),
    distributionId: field('distributionId')
  }
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

function friendlyError(err: unknown): StorageError {
  if (err instanceof S3ServiceException) {
    const status = err.$metadata.httpStatusCode ?? 0
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(err.name))
      return new StorageError('AWS rejected the access key. Run the setup script again and paste the new code.', false)
    if (err.name === 'NoSuchBucket') return new StorageError('The S3 bucket does not exist any more.', false)
    if (err.name === 'AccessDenied' || status === 403)
      return new StorageError('AWS denied access to the bucket. Run the setup script again.', false)
    return new StorageError(`AWS error ${err.name}: ${err.message}`, status >= 500 || status === 429)
  }
  // No HTTP response at all: offline, DNS, connection reset.
  return new StorageError(`Could not reach AWS: ${(err as Error).message}`, true)
}

function client(cfg: AwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 3
  })
}

/** 128 random bits, URL-safe. Unguessable, so links are unlisted by nature. */
export function newVideoId(): string {
  return randomBytes(16).toString('base64url')
}

export function shareUrl(cfg: AwsConfig, videoId: string): string {
  return `https://${cfg.cdnDomain}/v/${videoId}`
}

export function assetUrl(cfg: AwsConfig, key: string): string {
  return `https://${cfg.cdnDomain}/${key}`
}

// Video and thumbnail never change; the page might be regenerated, so it caches briefly.
export const CACHE_FOREVER = 'public, max-age=31536000, immutable'
export const CACHE_SHORT = 'public, max-age=300'

/** Streams a file from disk in 8 MB parts (parallel, each retried by the SDK). */
export async function putFile(
  cfg: AwsConfig,
  key: string,
  filePath: string,
  contentType: string,
  onProgress: (fraction: number) => void = () => {}
): Promise<void> {
  const size = (await stat(filePath)).size
  const upload = new Upload({
    client: client(cfg),
    params: {
      Bucket: cfg.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentLength: size,
      CacheControl: CACHE_FOREVER
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
    leavePartsOnError: false
  })
  upload.on('httpUploadProgress', (p) => onProgress(size ? (p.loaded ?? 0) / size : 1))
  try {
    await upload.done()
  } catch (err) {
    throw friendlyError(err)
  }
}

export async function putText(cfg: AwsConfig, key: string, body: string, contentType: string, cacheControl: string): Promise<void> {
  try {
    await client(cfg).send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl })
    )
  } catch (err) {
    throw friendlyError(err)
  }
}

export async function deleteKeys(cfg: AwsConfig, keys: string[]): Promise<void> {
  try {
    await client(cfg).send(
      new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } })
    )
  } catch (err) {
    throw friendlyError(err)
  }
}

/** The three objects behind one share link. */
export function videoKeys(videoId: string): string[] {
  return [`v/${videoId}`, `v/${videoId}.mp4`, `v/${videoId}.jpg`]
}

/**
 * Deletes a shared video from S3 and evicts it from CloudFront's edge caches, so the
 * link stops working everywhere within minutes instead of after the cache expires.
 */
export async function deleteVideo(cfg: AwsConfig, videoId: string): Promise<void> {
  await deleteKeys(cfg, videoKeys(videoId))
  try {
    // A wildcard path counts as one path; CloudFront's first 1,000 paths a month are free.
    await new CloudFrontClient({
      region: 'us-east-1',
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
    }).send(
      new CreateInvalidationCommand({
        DistributionId: cfg.distributionId,
        InvalidationBatch: {
          CallerReference: `krec-delete-${videoId}-${Date.now()}`,
          Paths: { Quantity: 1, Items: [`/v/${videoId}*`] }
        }
      })
    )
  } catch (err) {
    const detail = err instanceof CloudFrontServiceException ? err.name : (err as Error).message
    throw new StorageError(
      `The video was deleted, but clearing CloudFront's cache failed (${detail}). The link may keep working for up to a day.`,
      false
    )
  }
}

/**
 * End-to-end check: write a small file to S3, read it back through CloudFront, delete it.
 * Proves the key works, the bucket exists and viewers will be able to load videos.
 */
export async function testConnection(cfg: AwsConfig): Promise<void> {
  const key = `krec-check/${newVideoId()}.txt`
  const marker = `krec ${Date.now()}`
  await putText(cfg, key, marker, 'text/plain', 'no-store')
  try {
    let body = ''
    try {
      const res = await fetch(assetUrl(cfg, key), { signal: AbortSignal.timeout(15_000) })
      body = res.ok ? await res.text() : `HTTP ${res.status}`
    } catch (err) {
      body = (err as Error).message
    }
    if (body !== marker) {
      throw new StorageError(
        `Uploading works, but CloudFront does not serve the file yet (${body}). A new CloudFront ` +
          'distribution takes about 5 to 15 minutes to deploy. Try again in a few minutes.',
        true
      )
    }
  } finally {
    await deleteKeys(cfg, [key]).catch(() => {})
  }
}
