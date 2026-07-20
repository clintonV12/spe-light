// render.go — turns a reportContent tree into actual PDF/DOCX/XLSX bytes.
//
// All three formats are built by hand:
//   - PDF: raw PDF 1.4 object syntax (a handful of objects + an xref table).
//   - DOCX/XLSX: minimal-but-valid OOXML packages via archive/zip.
//
// No third-party document library is used or required — only
// archive/zip, bytes, fmt, and strings from the standard library. This is a
// deliberate choice given this codebase's dependency set wasn't available to
// verify against; if a proper PDF/OOXML library is already vendored
// elsewhere in the project, swapping these functions out for it is a
// drop-in replacement (they're the only thing service.go calls).
package reportsvc

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
)

// ── PDF ───────────────────────────────────────────────────────────────────

const (
	pdfPageWidth   = 612 // US Letter, points
	pdfPageHeight  = 792
	pdfMarginLeft  = 50
	pdfMarginTop   = 50
	pdfFontSize    = 10
	pdfLeading     = 14
	pdfLinesPerPg  = 48
	pdfWrapColumns = 92
)

// pdfWriter incrementally builds a PDF's object table, allowing objects to
// be reserved (e.g. the Pages object, which every Page must reference before
// its own Kids array can be known) and filled in out of order.
type pdfWriter struct {
	bodies map[int][]byte
	next   int
}

func newPDFWriter() *pdfWriter {
	return &pdfWriter{bodies: map[int][]byte{}, next: 1}
}

func (w *pdfWriter) reserve() int {
	id := w.next
	w.next++
	return id
}

func (w *pdfWriter) set(id int, body string) {
	w.bodies[id] = []byte(body)
}

func (w *pdfWriter) add(body string) int {
	id := w.reserve()
	w.set(id, body)
	return id
}

func (w *pdfWriter) build(rootID int) []byte {
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")

	maxID := w.next - 1
	offsets := make([]int, maxID+1)
	for id := 1; id <= maxID; id++ {
		offsets[id] = buf.Len()
		buf.WriteString(fmt.Sprintf("%d 0 obj\n", id))
		buf.Write(w.bodies[id])
		buf.WriteString("\nendobj\n")
	}

	xrefStart := buf.Len()
	buf.WriteString(fmt.Sprintf("xref\n0 %d\n", maxID+1))
	buf.WriteString("0000000000 65535 f \n")
	for id := 1; id <= maxID; id++ {
		buf.WriteString(fmt.Sprintf("%010d 00000 n \n", offsets[id]))
	}
	buf.WriteString(fmt.Sprintf("trailer\n<< /Size %d /Root %d 0 R >>\n", maxID+1, rootID))
	buf.WriteString(fmt.Sprintf("startxref\n%d\n%%%%EOF", xrefStart))
	return buf.Bytes()
}

func renderPDF(title string, rc *reportContent) ([]byte, error) {
	lines := flattenToLines(title, rc)

	w := newPDFWriter()
	catalogID := w.reserve()
	pagesID := w.reserve()
	fontID := w.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

	var pageIDs []int
	for start := 0; start < len(lines); start += pdfLinesPerPg {
		end := start + pdfLinesPerPg
		if end > len(lines) {
			end = len(lines)
		}
		pageIDs = append(pageIDs, addPDFPage(w, pagesID, fontID, lines[start:end]))
	}
	if len(pageIDs) == 0 {
		pageIDs = append(pageIDs, addPDFPage(w, pagesID, fontID, []string{title}))
	}

	kids := make([]string, len(pageIDs))
	for i, id := range pageIDs {
		kids[i] = fmt.Sprintf("%d 0 R", id)
	}
	w.set(pagesID, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pageIDs)))
	w.set(catalogID, fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", pagesID))

	return w.build(catalogID), nil
}

func addPDFPage(w *pdfWriter, pagesID, fontID int, lines []string) int {
	var content bytes.Buffer
	content.WriteString(fmt.Sprintf("BT\n/F1 %d Tf\n%d TL\n%d %d Td\n", pdfFontSize, pdfLeading, pdfMarginLeft, pdfPageHeight-pdfMarginTop))
	for i, ln := range lines {
		if i > 0 {
			content.WriteString("T*\n")
		}
		content.WriteString("(" + escapePDFText(ln) + ") Tj\n")
	}
	content.WriteString("ET")

	stream := content.String()
	contentID := w.add(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))

	return w.add(fmt.Sprintf(
		"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>",
		pagesID, pdfPageWidth, pdfPageHeight, fontID, contentID,
	))
}

// escapePDFText escapes PDF string-literal special characters and drops
// anything outside the printable ASCII range, since we're using a standard
// Type1 font with no custom encoding.
func escapePDFText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '(' || r == ')' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r >= 32 && r < 127:
			b.WriteRune(r)
		default:
			b.WriteByte('?')
		}
	}
	return b.String()
}

// flattenToLines turns the section tree into a flat list of text lines,
// wrapping long paragraphs and rendering tables as simple pipe-delimited
// rows — enough structure to be readable in a plain-text PDF layout.
func flattenToLines(title string, rc *reportContent) []string {
	lines := []string{title, strings.Repeat("=", len(title)), ""}
	for _, sec := range rc.Sections {
		lines = append(lines, sec.Heading, strings.Repeat("-", len(sec.Heading)))
		for _, p := range sec.Paragraphs {
			lines = append(lines, wrapText(p, pdfWrapColumns)...)
		}
		if sec.Table != nil {
			lines = append(lines, strings.Join(sec.Table.Headers, "  |  "))
			for _, row := range sec.Table.Rows {
				lines = append(lines, strings.Join(row, "  |  "))
			}
		}
		lines = append(lines, "")
	}
	return lines
}

func wrapText(s string, width int) []string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return []string{""}
	}
	var lines []string
	var cur strings.Builder
	for _, word := range words {
		if cur.Len() > 0 && cur.Len()+1+len(word) > width {
			lines = append(lines, cur.String())
			cur.Reset()
		}
		if cur.Len() > 0 {
			cur.WriteByte(' ')
		}
		cur.WriteString(word)
	}
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	return lines
}

// ── Shared: zip + XML escaping for DOCX/XLSX ────────────────────────────────

func buildZip(files map[string]string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte(content)); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func xmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

// ── DOCX ──────────────────────────────────────────────────────────────────

const docxContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const docxRootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

func renderDOCX(title string, rc *reportContent) ([]byte, error) {
	var body bytes.Buffer
	body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>` + xmlEscape(title) + `</w:t></w:r></w:p>`)

	for _, sec := range rc.Sections {
		body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>` + xmlEscape(sec.Heading) + `</w:t></w:r></w:p>`)
		for _, p := range sec.Paragraphs {
			body.WriteString(`<w:p><w:r><w:t xml:space="preserve">` + xmlEscape(p) + `</w:t></w:r></w:p>`)
		}
		if sec.Table != nil {
			body.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
				`<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>` +
				`<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>` +
				`<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>`)
			body.WriteString(docxTableRow(sec.Table.Headers, true))
			for _, row := range sec.Table.Rows {
				body.WriteString(docxTableRow(row, false))
			}
			body.WriteString(`</w:tbl>`)
		}
	}

	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:body>` + body.String() + `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`

	return buildZip(map[string]string{
		"[Content_Types].xml": docxContentTypes,
		"_rels/.rels":         docxRootRels,
		"word/document.xml":   documentXML,
	})
}

func docxTableRow(cells []string, bold bool) string {
	var row bytes.Buffer
	row.WriteString(`<w:tr>`)
	for _, c := range cells {
		rPr := ""
		if bold {
			rPr = `<w:rPr><w:b/></w:rPr>`
		}
		row.WriteString(`<w:tc><w:p><w:r>` + rPr + `<w:t xml:space="preserve">` + xmlEscape(c) + `</w:t></w:r></w:p></w:tc>`)
	}
	row.WriteString(`</w:tr>`)
	return row.String()
}

// ── XLSX ──────────────────────────────────────────────────────────────────

const xlsxContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const xlsxRootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const xlsxWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const xlsxWorkbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

func renderXLSX(title string, rc *reportContent) ([]byte, error) {
	rowIdx := 1
	var rows []string
	addRow := func(cells []string) {
		var cs []string
		for i, c := range cells {
			ref := colLetter(i) + fmt.Sprint(rowIdx)
			cs = append(cs, fmt.Sprintf(`<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlEscape(c)))
		}
		rows = append(rows, fmt.Sprintf(`<row r="%d">%s</row>`, rowIdx, strings.Join(cs, "")))
		rowIdx++
	}

	addRow([]string{title})
	addRow([]string{""})
	for _, sec := range rc.Sections {
		addRow([]string{sec.Heading})
		for _, p := range sec.Paragraphs {
			addRow([]string{p})
		}
		if sec.Table != nil {
			addRow(sec.Table.Headers)
			for _, row := range sec.Table.Rows {
				addRow(row)
			}
		}
		addRow([]string{""})
	}

	sheetXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<sheetData>` + strings.Join(rows, "") + `</sheetData></worksheet>`

	return buildZip(map[string]string{
		"[Content_Types].xml":        xlsxContentTypes,
		"_rels/.rels":                xlsxRootRels,
		"xl/workbook.xml":            xlsxWorkbook,
		"xl/_rels/workbook.xml.rels": xlsxWorkbookRels,
		"xl/worksheets/sheet1.xml":   sheetXML,
	})
}

// colLetter converts a 0-based column index to a spreadsheet column letter
// (0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, ...).
func colLetter(i int) string {
	s := ""
	i++
	for i > 0 {
		i--
		s = string(rune('A'+i%26)) + s
		i /= 26
	}
	return s
}
