import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';

// Render a tool draft (our small markdown subset) to a PDF letter buffer.
// The draft text already carries the firm letterhead/signatory (the model
// wrote them in), so the only image added is the firm logo at the top —
// hence the `logo` is optional ("with / without logo"). Pure JS renderer
// (no headless browser) so it runs fine on Vercel.

interface LogoInput {
  data: Buffer;
  mime: string;
}

type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'number'; text: string; n: number }
  | { type: 'hr' };

// Parse the markdown subset the tools emit (whole-line bold / # as heading,
// -/* bullets, 1. numbers, --- rule, blank line = paragraph break).
function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: para.join('\n') });
      para = [];
    }
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') {
      flush();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push({ type: 'hr' });
      continue;
    }
    const atx = t.match(/^#{1,6}\s+(.*)$/);
    if (atx) {
      flush();
      blocks.push({ type: 'heading', text: atx[1] });
      continue;
    }
    const boldHeading = t.match(/^\*\*(.+?)\*\*:?$/);
    if (boldHeading && !boldHeading[1].includes('**')) {
      flush();
      blocks.push({ type: 'heading', text: boldHeading[1] });
      continue;
    }
    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      if (bullet[1].trim()) blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }
    const num = t.match(/^(\d+)\.\s+(.*)$/);
    if (num) {
      flush();
      if (num[2].trim()) blocks.push({ type: 'number', text: num[2], n: Number(num[1]) });
      continue;
    }
    para.push(raw);
  }
  flush();
  return blocks;
}

// Split inline **bold** into runs so the PDF renders emphasis.
function inlineRuns(text: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    out.push(m ? { text: m[1], bold: true } : { text: part, bold: false });
  }
  return out;
}

const styles = StyleSheet.create({
  page: { paddingVertical: 56, paddingHorizontal: 56, fontFamily: 'Helvetica', fontSize: 11 },
  // Height-only so the width scales by aspect ratio; flex-start keeps the
  // logo's left edge on the text margin (no centering in a wide box).
  logo: { height: 52, marginBottom: 18, alignSelf: 'flex-start' },
  heading: { fontFamily: 'Helvetica-Bold', fontSize: 12, marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 8, lineHeight: 1.45 },
  // Short standalone lines — letterhead, address, salutation, signoff — sit
  // tight so they read as a block instead of double-spaced.
  paragraphTight: { marginBottom: 2, lineHeight: 1.3 },
  listItem: { flexDirection: 'row', marginBottom: 3, lineHeight: 1.4 },
  bulletMark: { width: 16 },
  listText: { flex: 1 },
  hr: { borderBottomWidth: 1, borderBottomColor: '#cccccc', marginVertical: 10 },
});

function Runs({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable order, static render
        <Text key={i} style={r.bold ? { fontFamily: 'Helvetica-Bold' } : undefined}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

function LetterDoc({ content, logoSrc }: { content: string; logoSrc?: string }) {
  const blocks = parseBlocks(content);
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
        {blocks.map((b, i) => {
          const key = i;
          if (b.type === 'hr') return <View key={key} style={styles.hr} />;
          if (b.type === 'heading')
            return (
              <Text key={key} style={styles.heading}>
                <Runs text={b.text} />
              </Text>
            );
          if (b.type === 'bullet')
            return (
              <View key={key} style={styles.listItem}>
                <Text style={styles.bulletMark}>•</Text>
                <Text style={styles.listText}>
                  <Runs text={b.text} />
                </Text>
              </View>
            );
          if (b.type === 'number')
            return (
              <View key={key} style={styles.listItem}>
                <Text style={styles.bulletMark}>{b.n}.</Text>
                <Text style={styles.listText}>
                  <Runs text={b.text} />
                </Text>
              </View>
            );
          // Short single lines (letterhead / address / salutation) group
          // tightly; prose paragraphs keep full spacing.
          const tight = !b.text.includes('\n') && b.text.trim().length <= 55;
          return (
            <Text key={key} style={tight ? styles.paragraphTight : styles.paragraph}>
              <Runs text={b.text} />
            </Text>
          );
        })}
      </Page>
    </Document>
  );
}

export async function renderLetterPdf(args: {
  content: string;
  logo?: LogoInput;
}): Promise<Buffer> {
  const logoSrc = args.logo
    ? `data:${args.logo.mime};base64,${args.logo.data.toString('base64')}`
    : undefined;
  return renderToBuffer(<LetterDoc content={args.content} logoSrc={logoSrc} />);
}
