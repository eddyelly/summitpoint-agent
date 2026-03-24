import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../config';

export async function getCachedTemplate(url: string): Promise<Buffer> {
  const cacheDir = config.templateCacheDir;
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const hash = crypto.createHash('md5').update(url).digest('hex');
  const ext = path.extname(new URL(url).pathname) || '.png';
  const cachePath = path.join(cacheDir, `${hash}${ext}`);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  const buffer = Buffer.from(response.data);
  fs.writeFileSync(cachePath, buffer);
  return buffer;
}

export async function preWarmCache(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await getCachedTemplate(url);
      console.log(`  Cached: ${url}`);
    } catch (err: any) {
      console.error(`  Failed to cache: ${url}`, err.message);
    }
  }
}
