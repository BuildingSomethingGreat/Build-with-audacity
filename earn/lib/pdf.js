// Render a book object to a clean, minimal PDF.
import fs from 'node:fs';
import PDFDocument from 'pdfkit';

export function renderPdf(book, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margins: { top: 60, bottom: 60, left: 54, right: 54 } });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    // Cover
    doc.moveDown(8).font('Helvetica-Bold').fontSize(26).text(book.title, { align: 'center' });
    doc.moveDown(1).font('Helvetica').fontSize(13).fillColor('#555').text(book.subtitle, { align: 'center' });
    doc.fillColor('#000');

    // Chapters
    for (const ch of book.chapters) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(18).text(ch.title);
      doc.moveDown(0.8).font('Helvetica').fontSize(11).text(ch.body, { lineGap: 4, paragraphGap: 8 });
    }

    // Journal pages
    for (const prompt of book.prompts || []) {
      doc.addPage();
      doc.font('Helvetica-Oblique').fontSize(13).text(prompt);
      doc.moveDown(1.5);
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      for (let y = doc.y; y < doc.page.height - 80; y += 26) {
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#ddd').stroke();
      }
    }

    doc.end();
    stream.on('finish', resolve).on('error', reject);
  });
}
