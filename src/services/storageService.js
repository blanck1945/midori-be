const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const { config } = require('../config');

let _client = null;

function getClient() {
  if (!_client) {
    const options = {
      region: 'auto',
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    };

    // On Windows dev, Node's OpenSSL can fail the TLS handshake against R2.
    // This only applies locally — production (Linux) works without this.
    if (config.appEnv !== 'production') {
      options.requestHandler = new NodeHttpHandler({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
    }

    _client = new S3Client(options);
  }
  return _client;
}

// dataUrl: "data:image/jpeg;base64,..."
// Returns the public URL of the uploaded file
async function uploadImageFromDataUrl(dataUrl, key) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Formato de imagen inválido');

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return `${config.r2PublicUrl}/${key}`;
}

module.exports = { uploadImageFromDataUrl };
