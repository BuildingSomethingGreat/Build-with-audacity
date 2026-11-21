// Books live on disk: BOOKS_DIR/<slug>/book.json + book.pdf (a Fly volume in production).
import fs from 'node:fs';
import path from 'node:path';

export const booksDir = () => path.resolve(process.env.BOOKS_DIR || './books');

export function listBooks() {
  const dir = booksDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((slug) => getBook(slug))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBook(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || '')) return null;
  const file = path.join(booksDir(), slug, 'book.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export function saveBook(book) {
  const dir = path.join(booksDir(), book.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(book, null, 2));
  return dir;
}

export const pdfPath = (slug) => path.join(booksDir(), slug, 'book.pdf');
