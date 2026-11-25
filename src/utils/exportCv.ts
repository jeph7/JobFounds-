import { jsPDF } from 'jspdf';
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { CvDocument, Lang } from '../types';

const SECTION_LABELS: Record<
  Lang,
  {
    summary: string;
    experience: string;
    education: string;
    skills: string;
    languages: string;
  }
> = {
  fr: {
    summary: 'Synthèse professionnelle',
    experience: 'Expériences professionnelles',
    education: 'Formation',
    skills: 'Compétences',
    languages: 'Langues',
  },
  en: {
    summary: 'Professional Summary',
    experience: 'Professional Experience',
    education: 'Education',
    skills: 'Skills',
    languages: 'Languages',
  },
  es: {
    summary: 'Resumen profesional',
    experience: 'Experiencia profesional',
    education: 'Formación académica',
    skills: 'Competencias',
    languages: 'Idiomas',
  },
  de: {
    summary: 'Berufliches Profil',
    experience: 'Berufserfahrung',
    education: 'Ausbildung',
    skills: 'Kompetenzen',
    languages: 'Sprachen',
  },
  pt: {
    summary: 'Resumo profissional',
    experience: 'Experiência profissional',
    education: 'Formação acadêmica',
    skills: 'Competências',
    languages: 'Idiomas',
  },
  ar: {
    summary: 'الملخص المهني',
    experience: 'الخبرة المهنية',
    education: 'التعليم',
    skills: 'المهارات',
    languages: 'اللغات',
  },
};

export function serializeCvToPlainText(cv: CvDocument): string {
  const lines: string[] = [
    cv.fullName,
    cv.headline,
    [cv.location, cv.email, cv.phone, cv.linkedin].filter(Boolean).join(' | '),
    '',
    'PROFIL / SUMMARY',
    cv.summary,
    '',
    'EXPERIENCE',
    ...cv.experiences.flatMap((exp) => [
      `${exp.role} — ${exp.company} (${exp.location}) | ${exp.period}`,
      ...exp.highlights.map((h) => `- ${h}`),
      '',
    ]),
    'EDUCATION',
    ...cv.education.map((edu) => `${edu.degree} — ${edu.institution} (${edu.year})`),
    '',
    'SKILLS',
    cv.skills.join(', '),
    '',
    'LANGUAGES',
    cv.languages.join(', '),
  ];
  return lines.join('\n').trim();
}

export function exportCvAsPdf(cv: CvDocument, lang: Lang): void {
  const labels = SECTION_LABELS[lang] || SECTION_LABELS.en;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const maxWidth = pageWidth - margin * 2;
  let y = 52;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 46) {
      doc.addPage();
      y = 50;
    }
  };

  const accentColor: [number, number, number] =
    cv.template === 'executive'
      ? [6, 19, 47]
      : cv.template === 'structured'
        ? [40, 123, 199]
        : [16, 43, 82];

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...accentColor);
  doc.text(cv.fullName || 'Candidate', margin, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text(cv.headline || '', margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const contactLine = [cv.location, cv.email, cv.phone, cv.linkedin].filter(Boolean).join('  ·  ');
  const wrappedContact = doc.splitTextToSize(contactLine, maxWidth);
  doc.text(wrappedContact, margin, y);
  y += wrappedContact.length * 13 + 8;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  const drawSectionTitle = (title: string) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...accentColor);
    doc.text(title.toUpperCase(), margin, y);
    y += 6;
    doc.setDrawColor(213, 228, 242);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  };

  if (cv.summary.trim()) {
    drawSectionTitle(labels.summary);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(cv.summary, maxWidth);
    ensureSpace(lines.length * 14);
    doc.text(lines, margin, y);
    y += lines.length * 14 + 14;
  }

  if (cv.experiences.length > 0) {
    drawSectionTitle(labels.experience);
    for (const exp of cv.experiences) {
      ensureSpace(48);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(6, 19, 47);
      doc.text(`${exp.role} — ${exp.company}`, margin, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(85, 110, 145);
      const rightMeta = `${exp.period}`;
      const metaWidth = doc.getTextWidth(rightMeta);
      doc.text(rightMeta, pageWidth - margin - metaWidth, y);
      y += 13;

      if (exp.location) {
        doc.text(exp.location, margin, y);
        y += 13;
      }

      doc.setFontSize(9.5);
      doc.setTextColor(31, 56, 92);
      for (const bullet of exp.highlights.filter(Boolean)) {
        const bulletLines = doc.splitTextToSize(`•  ${bullet}`, maxWidth - 10);
        ensureSpace(bulletLines.length * 13 + 4);
        doc.text(bulletLines, margin + 6, y);
        y += bulletLines.length * 13 + 3;
      }
      y += 8;
    }
  }

  if (cv.education.length > 0) {
    drawSectionTitle(labels.education);
    for (const edu of cv.education) {
      ensureSpace(28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(6, 19, 47);
      doc.text(edu.degree, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(85, 110, 145);
      const yearWidth = doc.getTextWidth(edu.year);
      doc.text(edu.year, pageWidth - margin - yearWidth, y);
      y += 13;
      doc.setTextColor(31, 56, 92);
      doc.text(edu.institution, margin, y);
      y += 16;
    }
  }

  if (cv.skills.length > 0) {
    drawSectionTitle(labels.skills);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(31, 56, 92);
    const skillLines = doc.splitTextToSize(cv.skills.join('  ·  '), maxWidth);
    ensureSpace(skillLines.length * 14);
    doc.text(skillLines, margin, y);
    y += skillLines.length * 14 + 12;
  }

  if (cv.languages.length > 0) {
    drawSectionTitle(labels.languages);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(31, 56, 92);
    const langLines = doc.splitTextToSize(cv.languages.join('  ·  '), maxWidth);
    ensureSpace(langLines.length * 14);
    doc.text(langLines, margin, y);
  }

  const safeName = (cv.fullName || 'CV').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeVer = (cv.versionName || 'JOB_FONDS').replace(/[^a-zA-Z0-9_-]+/g, '_');
  doc.save(`${safeName}_${safeVer}.pdf`);
}

/**
 * Generates a native Office Open XML (.docx) Word document styled with the JOBFOUNDS palette.
 */
export async function exportCvAsWord(cv: CvDocument, lang: Lang): Promise<void> {
  const labels = SECTION_LABELS[lang] || SECTION_LABELS.en;
  const accentHex =
    cv.template === 'structured' ? '287BC7' : cv.template === 'executive' ? '06132F' : '102B52';

  const makeSectionHeader = (title: string) =>
    new Paragraph({
      spacing: { before: 240, after: 100 },
      border: {
        bottom: {
          color: 'D5E4F2',
          space: 4,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          color: accentHex,
          size: 21,
          font: 'Calibri',
        }),
      ],
    });

  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: cv.fullName || 'Candidate',
          bold: true,
          color: accentHex,
          size: 40,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: cv.headline || '',
          color: '1F385C',
          size: 23,
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 180 },
      border: {
        bottom: {
          color: 'B3CBE2',
          space: 6,
          style: BorderStyle.SINGLE,
          size: 8,
        },
      },
      children: [
        new TextRun({
          text: [cv.location, cv.email, cv.phone, cv.linkedin].filter(Boolean).join('  ·  '),
          color: '556E91',
          size: 19,
          font: 'Calibri',
        }),
      ],
    }),
  ];

  if (cv.summary.trim()) {
    children.push(
      makeSectionHeader(labels.summary),
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: cv.summary,
            color: '1F385C',
            size: 20,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  if (cv.experiences.length > 0) {
    children.push(makeSectionHeader(labels.experience));
    for (const exp of cv.experiences) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({
              text: `${exp.role} — ${exp.company}`,
              bold: true,
              color: '06132F',
              size: 21,
              font: 'Calibri',
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: [exp.location, exp.period].filter(Boolean).join('  ·  '),
              color: '556E91',
              size: 18,
              italics: true,
              font: 'Calibri',
            }),
          ],
        })
      );

      for (const highlight of exp.highlights.filter(Boolean)) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: highlight,
                color: '1F385C',
                size: 20,
                font: 'Calibri',
              }),
            ],
          })
        );
      }
    }
  }

  if (cv.education.length > 0) {
    children.push(makeSectionHeader(labels.education));
    for (const edu of cv.education) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({
              text: edu.degree,
              bold: true,
              color: '06132F',
              size: 20,
              font: 'Calibri',
            }),
            new TextRun({
              text: ` — ${edu.institution} (${edu.year})`,
              color: '1F385C',
              size: 20,
              font: 'Calibri',
            }),
          ],
        })
      );
    }
  }

  if (cv.skills.length > 0) {
    children.push(
      makeSectionHeader(labels.skills),
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: cv.skills.join('  ·  '),
            color: '1F385C',
            size: 20,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  if (cv.languages.length > 0) {
    children.push(
      makeSectionHeader(labels.languages),
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: cv.languages.join('  ·  '),
            color: '1F385C',
            size: 20,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  const wordDoc = new Document({
    creator: 'JOBFOUNDS',
    title: `${cv.fullName} — CV`,
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(wordDoc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = (cv.fullName || 'CV').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeVer = (cv.versionName || 'JOB_FONDS').replace(/[^a-zA-Z0-9_-]+/g, '_');
  link.href = url;
  link.download = `${safeName}_${safeVer}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
