import crypto from 'node:crypto';

console.log(`JWT_ACCESS_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
