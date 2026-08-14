// render.go — turns a reportContent tree into branded, enterprise-grade
// PDF/DOCX/XLSX bytes for the SPE-Lite platform (by DGRV Eswatini).
//
// Every export carries a consistent letterhead: a cover page with the
// organisation's name, industry, location, contact details, the plan it was
// generated from, who generated it and when, plus a running header/footer,
// page numbering and a confidentiality notice on every subsequent page.
// Tables are drawn with real borders, shaded header rows and banded body
// rows rather than pipe-delimited text. Content itself (report_service.go's
// buildContent) always opens with a structured "Organisational Information"
// table before any requested sections, then the plan's Pillar > Objective >
// Activity breakdown and, if the plan has any, a separate Advanced Research
// section — see buildContent.
//
// As before, everything is built by hand with only the standard library
// (archive/zip, image/jpeg, bytes, fmt, strings) — no third-party PDF/OOXML
// dependency is required. Swapping these functions out for a proper document
// library later is a drop-in replacement; report_service.go is the only
// caller.
//
// Branding assets:
//   - The SPE-Lite / DGRV Eswatini logo is optional. Set REPORT_LOGO_PATH to
//     the on-disk path of a JPEG (e.g. a server-side copy of the frontend's
//     public/logo.jpg) or drop the file at ./assets/logo.jpg. If it can't be
//     found or decoded, reports still render — just with a text wordmark
//     instead of the mark itself — generation never fails because of it.
//   - Brand colours are set once, below, as sensible defaults (navy +
//     gold). Swap the hex/RGB constants for the exact DGRV Eswatini brand
//     kit values when available.
package reportsvc

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image/color"
	"image/jpeg"
	"os"
	"reflect"
	"strings"
	"time"
)

// ── Report metadata (letterhead) ─────────────────────────────────────────

// reportMeta carries the letterhead information that isn't part of the
// section content itself — who/what/when this report is for. Built once by
// report_service.go and threaded into every renderer.
type reportMeta struct {
	ReportTitle     string // shown large on the cover — the plan's title
	ReportTypeLabel string // human label for the report type, e.g. "Full Plan Report"
	PlanTitle       string
	PlanStatus      string
	OrgName         string
	OrgIndustry     string
	// OrgLocation and OrgContact are pre-joined display strings (e.g.
	// "123 Main St, Eswatini" / "info@org.org  ·  +268 1234 5678") built by
	// buildMeta from the org's self-service profile fields (address,
	// country, contact_email, contact_phone — see orgsvc.UpdateOrgProfile).
	// Pre-joining here keeps the PDF/DOCX/XLSX renderers below from each
	// having to duplicate the "which parts are actually set" logic.
	OrgLocation string
	OrgContact  string
	GeneratedBy string
	GeneratedAt time.Time
	// Progress feeds the cover page's circular completion badge (see
	// buildCover) — pulled from the same progress data buildContent
	// already fetches for the report body, so the cover shows a real,
	// current stat rather than decorative stock imagery. See
	// report_service.go's coverStats.
	Progress coverStats
}

// reportTypeLabel maps the fixed report type enum onto a human-readable
// title used on the cover page and in the header. Takes a plain string
// (report_service.go passes string(req.Type)) so this file doesn't need to
// import the models package.
func reportTypeLabel(t string) string {
	switch t {
	case "full_plan":
		return "Full Plan Report"
	case "executive_summary":
		return "Executive Summary"
	case "per_phase":
		return "Per-Phase Report"
	case "progress_status":
		return "Progress & Status Report"
	case "activity_detail":
		return "Activity Detail Report"
	case "custom":
		return "Custom Report"
	default:
		return "Report"
	}
}

// ── Brand palette ─────────────────────────────────────────────────────────
// Defaults — replace with the exact DGRV Eswatini brand hex values once
// available. All PDF colours are 0–1 RGB triples; DOCX/XLSX use the hex
// strings alongside.

var (
	brandPrimary = [3]float64{0.106, 0.227, 0.388} // #1B3A63 navy
	brandAccent  = [3]float64{0.737, 0.573, 0.114} // #BC921D gold
	inkDark      = [3]float64{0.16, 0.16, 0.18}    // #29292E
	inkMed       = [3]float64{0.35, 0.37, 0.42}    // #5A5F6A
	inkLight     = [3]float64{0.54, 0.56, 0.60}    // #8A8F99
	bandLight    = [3]float64{0.95, 0.96, 0.97}    // #F2F3F5
	white        = [3]float64{1, 1, 1}
	borderGray   = [3]float64{0.84, 0.85, 0.87} // #D5D8DD
)

const (
	brandPrimaryHex = "1B3A63"
	brandAccentHex  = "BC921D"
	inkDarkHex      = "26282E"
	inkMedHex       = "5A5F6A"
	inkLightHex     = "8A8F99"
	bandLightHex    = "F2F3F5"
	borderGrayHex   = "D5D8DD"
)

// ── Logo asset ────────────────────────────────────────────────────────────

// pdfLogo is a decoded JPEG ready to be embedded as a PDF XObject or a DOCX
// media part.
type pdfLogo struct {
	Bytes      []byte
	Width      int
	Height     int
	ColorSpace string // PDF colour space name, e.g. "/DeviceRGB"
	Decode     string // extra " /Decode [...]" entry, only set for CMYK
}

// loadLogoAsset reads and decodes a JPEG logo from disk. Returns an error
// (never a partial/invalid asset) if the file is missing or not a valid
// JPEG — callers should treat that as "no logo" and fall back to a
// text-only wordmark rather than failing report generation.
func loadLogoAsset(path string) (*pdfLogo, error) {
	if path == "" {
		return nil, fmt.Errorf("no logo path configured")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode jpeg config: %w", err)
	}
	l := &pdfLogo{Bytes: data, Width: cfg.Width, Height: cfg.Height, ColorSpace: "/DeviceRGB"}

	// image/color's model globals wrap function values, which aren't safe to
	// compare with ==, so identify the model by function pointer via reflect
	// instead of a direct interface comparison.
	fnPtr := func(m color.Model) uintptr { return reflect.ValueOf(m).Pointer() }
	switch fnPtr(cfg.ColorModel) {
	case fnPtr(color.GrayModel):
		l.ColorSpace = "/DeviceGray"
	case fnPtr(color.CMYKModel):
		l.ColorSpace = "/DeviceCMYK"
		l.Decode = " /Decode [1 0 1 0 1 0 1 0]"
	}
	return l, nil
}

// emuSize returns the DrawingML (EMU) width/height for the logo scaled to
// fit within the given bounds (inches), preserving aspect ratio.
func (l *pdfLogo) emuSize(maxHIn, maxWIn float64) (cx, cy int64) {
	if l == nil || l.Height == 0 {
		return 0, 0
	}
	ratio := float64(l.Width) / float64(l.Height)
	hIn, wIn := maxHIn, maxHIn*ratio
	if wIn > maxWIn {
		wIn = maxWIn
		hIn = wIn / ratio
	}
	return int64(wIn * 914400), int64(hIn * 914400)
}

// ptSize returns the logo's display size in PDF points, scaled to fit
// within maxH×maxW.
func (l *pdfLogo) ptSize(maxH, maxW float64) (w, h float64) {
	if l == nil || l.Height == 0 {
		return 0, 0
	}
	ratio := float64(l.Width) / float64(l.Height)
	h, w = maxH, maxH*ratio
	if w > maxW {
		w = maxW
		h = w / ratio
	}
	return w, h
}

// ══════════════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════════════

const (
	pdfPageWidth  = 612.0 // US Letter, points
	pdfPageHeight = 792.0
	pdfMarginL    = 50.0
	pdfMarginR    = 50.0
	pdfMarginTop  = 56.0
	pdfMarginBot  = 56.0
	pdfContentW   = pdfPageWidth - pdfMarginL - pdfMarginR
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

func (w *pdfWriter) set(id int, body string) { w.bodies[id] = []byte(body) }

func (w *pdfWriter) add(body string) int {
	id := w.reserve()
	w.set(id, body)
	return id
}

// addImageXObject registers a JPEG as a DCTDecode image XObject and returns
// its object ID.
func (w *pdfWriter) addImageXObject(l *pdfLogo) int {
	header := fmt.Sprintf(
		"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode%s /Length %d >>\nstream\n",
		l.Width, l.Height, l.ColorSpace, l.Decode, len(l.Bytes),
	)
	body := append([]byte(header), l.Bytes...)
	body = append(body, []byte("\nendstream")...)
	id := w.reserve()
	w.bodies[id] = body
	return id
}

func (w *pdfWriter) addContentStream(ops []string) int {
	stream := strings.Join(ops, "\n")
	return w.add(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
}

func (w *pdfWriter) addPage(pagesID int, resources string, contentID int) int {
	return w.add(fmt.Sprintf(
		"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.0f %.0f] /Resources %s /Contents %d 0 R >>",
		pagesID, pdfPageWidth, pdfPageHeight, resources, contentID,
	))
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

// ── Content-stream drawing primitives ───────────────────────────────────

type pdfPage struct {
	ops []string
}

func (p *pdfPage) add(op string) { p.ops = append(p.ops, op) }

func pdfRect(p *pdfPage, x, y, w, h float64, c [3]float64) {
	p.add(fmt.Sprintf("%.3f %.3f %.3f rg\n%.2f %.2f %.2f %.2f re\nf", c[0], c[1], c[2], x, y, w, h))
}

func pdfLine(p *pdfPage, x1, y1, x2, y2 float64, c [3]float64, width float64) {
	p.add(fmt.Sprintf("%.3f %.3f %.3f RG\n%.2f w\n%.2f %.2f m\n%.2f %.2f l\nS", c[0], c[1], c[2], width, x1, y1, x2, y2))
}

// bezierCircleK is the standard cubic-bezier control-point offset (as a
// fraction of the radius) used to approximate a circle with 4 arcs — the
// commonly cited constant for a <1% radius error, good enough at any size
// we draw here.
const bezierCircleK = 0.5522847498

// circlePath returns the path operators (no fill/stroke) tracing a full
// circle of radius r centered at (cx, cy) using 4 cubic-bezier arcs,
// starting and ending at the rightmost point.
func circlePath(cx, cy, r float64) string {
	k := r * bezierCircleK
	return fmt.Sprintf(
		"%.2f %.2f m\n%.2f %.2f %.2f %.2f %.2f %.2f c\n%.2f %.2f %.2f %.2f %.2f %.2f c\n%.2f %.2f %.2f %.2f %.2f %.2f c\n%.2f %.2f %.2f %.2f %.2f %.2f c\nh",
		cx+r, cy,
		cx+r, cy+k, cx+k, cy+r, cx, cy+r,
		cx-k, cy+r, cx-r, cy+k, cx-r, cy,
		cx-r, cy-k, cx-k, cy-r, cx, cy-r,
		cx+k, cy-r, cx+r, cy-k, cx+r, cy,
	)
}

// pdfCircle draws a filled circle — used for the cover page's progress
// badge (see buildCover).
func pdfCircle(p *pdfPage, cx, cy, r float64, c [3]float64) {
	p.add(fmt.Sprintf("%.3f %.3f %.3f rg\n%s\nf", c[0], c[1], c[2], circlePath(cx, cy, r)))
}

// pdfRing draws a filled annulus (a circle with a same-centered circular
// hole) via the even-odd fill rule — two circle subpaths wound the same
// direction fill as a ring rather than two overlapping solid disks. Used
// for the thin accent border around the cover page's progress badge.
func pdfRing(p *pdfPage, cx, cy, rOuter, rInner float64, c [3]float64) {
	p.add(fmt.Sprintf("%.3f %.3f %.3f rg\n%s\n%s\nf*", c[0], c[1], c[2], circlePath(cx, cy, rOuter), circlePath(cx, cy, rInner)))
}

// pdfWaveBandTop fills the region from the top of the page down to a
// single smooth curve running from (0, leftBottomY) to (pageWidth,
// rightBottomY) — the decorative "wave" band across the top of the cover
// page. Both ends of the curve have a horizontal tangent (the standard
// trick for a smooth single-arc bezier through two points), which is what
// keeps it reading as one gentle wave rather than an S-curve.
func pdfWaveBandTop(p *pdfPage, topY, leftBottomY, rightBottomY float64, c [3]float64) {
	ctrl1X, ctrl2X := pdfPageWidth*0.65, pdfPageWidth*0.35
	p.add(fmt.Sprintf(
		"%.3f %.3f %.3f rg\n0 %.2f m\n%.2f %.2f l\n%.2f %.2f l\n%.2f %.2f %.2f %.2f 0 %.2f c\nh\nf",
		c[0], c[1], c[2],
		topY,
		pdfPageWidth, topY,
		pdfPageWidth, rightBottomY,
		ctrl1X, rightBottomY, ctrl2X, leftBottomY, leftBottomY,
	))
}

// pdfWaveBandBottom is pdfWaveBandTop's mirror image for the bottom of the
// page: fills from the page's bottom edge up to a curve running from
// (0, leftTopY) to (pageWidth, rightTopY).
func pdfWaveBandBottom(p *pdfPage, leftTopY, rightTopY float64, c [3]float64) {
	ctrl1X, ctrl2X := pdfPageWidth*0.35, pdfPageWidth*0.65
	p.add(fmt.Sprintf(
		"%.3f %.3f %.3f rg\n0 0 m\n0 %.2f l\n%.2f %.2f %.2f %.2f %.2f %.2f c\n%.2f 0 l\nh\nf",
		c[0], c[1], c[2],
		leftTopY,
		ctrl1X, leftTopY, ctrl2X, rightTopY, pdfPageWidth, rightTopY,
		pdfPageWidth,
	))
}

// tint lightens a brand color toward white by amt (0 = unchanged, 1 =
// white) — used to draw a lighter second layer just behind the cover
// page's wave bands for a bit of depth, without hardcoding a second brand
// color.
func tint(c [3]float64, amt float64) [3]float64 {
	return [3]float64{
		c[0] + (1-c[0])*amt,
		c[1] + (1-c[1])*amt,
		c[2] + (1-c[2])*amt,
	}
}

func pdfText(p *pdfPage, font string, size float64, x, y float64, c [3]float64, text string) {
	p.add(fmt.Sprintf("BT\n/%s %.1f Tf\n%.3f %.3f %.3f rg\n%.2f %.2f Td\n(%s) Tj\nET",
		font, size, c[0], c[1], c[2], x, y, escapePDFText(text)))
}

// pdfTextRight right-aligns text against rightX using an approximate
// Helvetica average-glyph-width heuristic (there's no font-metrics table in
// this hand-rolled renderer, so this is a good-enough estimate, not exact
// kerning).
func pdfTextRight(p *pdfPage, font string, size float64, rightX, y float64, c [3]float64, text string) {
	text = asciiFold(text)
	width := float64(len(text)) * size * 0.5
	pdfText(p, font, size, rightX-width, y, c, text)
}

// pdfTextCenter horizontally centers text around cx — used for the cover
// page's circular completion badge (see buildCover), where text sits
// inside a fixed-width circle rather than against a page margin.
func pdfTextCenter(p *pdfPage, font string, size float64, cx, y float64, c [3]float64, text string) {
	text = asciiFold(text)
	width := float64(len(text)) * size * 0.5
	pdfText(p, font, size, cx-width/2, y, c, text)
}

func pdfImageDraw(p *pdfPage, name string, x, y, w, h float64) {
	p.add(fmt.Sprintf("q\n%.2f 0 0 %.2f %.2f %.2f cm\n/%s Do\nQ", w, h, x, y, name))
}

func charsForWidth(widthPt, fontSize float64) int {
	avgCharWidth := fontSize * 0.5
	n := int(widthPt / avgCharWidth)
	if n < 4 {
		n = 4
	}
	return n
}

func resourcesDict(fontReg, fontBold, logoID int) string {
	xobj := ""
	if logoID != 0 {
		xobj = fmt.Sprintf(" /XObject << /Logo %d 0 R >>", logoID)
	}
	return fmt.Sprintf("<< /Font << /F1 %d 0 R /F2 %d 0 R >>%s >>", fontReg, fontBold, xobj)
}

// ── Page-flow builder ────────────────────────────────────────────────────

// pdfDoc lays out a cover page followed by any number of flowing content
// pages, wrapping headings/paragraphs/tables and starting new pages as
// content overflows. Page numbers and the letterhead footer are applied at
// build() time, once the total page count is known.
type pdfDoc struct {
	w         *pdfWriter
	catalogID int
	pagesID   int
	fontReg   int
	fontBold  int
	logoID    int
	logo      *pdfLogo
	meta      reportMeta

	cover *pdfPage
	pages []*pdfPage
	cur   *pdfPage
	y     float64
}

func newPDFDoc(meta reportMeta, logo *pdfLogo) *pdfDoc {
	w := newPDFWriter()
	d := &pdfDoc{w: w, meta: meta, logo: logo}
	d.catalogID = w.reserve()
	d.pagesID = w.reserve()
	d.fontReg = w.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	d.fontBold = w.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
	if logo != nil {
		d.logoID = w.addImageXObject(logo)
	}
	d.buildCover()
	d.newContentPage()
	return d
}

func (d *pdfDoc) newContentPage() {
	p := &pdfPage{}
	d.pages = append(d.pages, p)
	d.cur = p
	d.drawContentHeader()
	d.y = pdfPageHeight - pdfMarginTop - 6
}

func (d *pdfDoc) drawContentHeader() {
	top := pdfPageHeight - 34
	pdfText(d.cur, "F2", 8.5, pdfMarginL, top, brandPrimary, "SPE-Lite")
	pdfText(d.cur, "F1", 8, pdfMarginL+42, top, inkLight, "by DGRV Eswatini")
	pdfTextRight(d.cur, "F1", 8, pdfPageWidth-pdfMarginR, top, inkMed, d.meta.OrgName)
	pdfLine(d.cur, pdfMarginL, top-10, pdfPageWidth-pdfMarginR, top-10, borderGray, 0.75)
}

func (d *pdfDoc) footer(p *pdfPage, pageNum, total int) {
	y := pdfMarginBot - 22
	pdfLine(p, pdfMarginL, y+14, pdfPageWidth-pdfMarginR, y+14, borderGray, 0.5)
	pdfText(p, "F1", 7.5, pdfMarginL, y, inkLight, "SPE-Lite by DGRV Eswatini - Confidential")
	pdfTextRight(p, "F1", 7.5, pdfPageWidth-pdfMarginR, y, inkLight, fmt.Sprintf("Page %d of %d", pageNum, total))
}

func (d *pdfDoc) ensureSpace(h float64) {
	if d.y-h < pdfMarginBot+16 {
		d.newContentPage()
	}
}

// buildCover draws the report's cover page: a two-tone wave band across the
// top (echoing the brand's swoosh motif), the organisation's name/logo and
// the platform credit within it, a circular badge showing the plan's real
// completion stats (in place of decorative stock photography — there's no
// image asset for that, and this is more useful anyway), the report title
// and letterhead details, and a matching wave band at the bottom.
//
// Layout note: every element below the wave band and badge is placed with
// a running y cursor (the same pattern the rest of this file uses), and
// the title is capped at 2 lines / letterhead values are truncated to a
// single line (see truncateToWidth) — so however long an org name, plan
// title, or contact string turns out to be, this can only ever push
// content *down*, never sideways into the badge or off the page. The
// worst case (2-line title, every letterhead field populated) still ends
// comfortably above the confidentiality notice — see the width/line-count
// budget in each section below if adjusting these numbers.
func (d *pdfDoc) buildCover() {
	p := &pdfPage{}
	d.cover = p

	// ── Top wave band (two-tone: a lighter sliver peeking out beneath the
	// main navy curve for a bit of depth) — taller on the left where the
	// org identity/title sit, shorter on the right where the badge breaks
	// through it. ──
	topY := pdfPageHeight
	leftBottomY := pdfPageHeight - 255
	rightBottomY := pdfPageHeight - 150
	const tintDrop = 14
	pdfWaveBandTop(p, topY, leftBottomY-tintDrop, rightBottomY-tintDrop, tint(brandPrimary, 0.38))
	pdfWaveBandTop(p, topY, leftBottomY, rightBottomY, brandPrimary)

	// ── Circular completion badge — placed first (numerically) so its
	// bounds are known before the org wordmark/title are truncated/wrapped
	// around it. ──
	badgeCx := pdfPageWidth - pdfMarginR - 78
	badgeCy := rightBottomY - 40
	const badgeOuterR, badgeInnerR, badgeFaceR = 92.0, 84.0, 80.0
	pdfRing(p, badgeCx, badgeCy, badgeOuterR, badgeInnerR, brandAccent)
	pdfCircle(p, badgeCx, badgeCy, badgeFaceR, brandPrimary)
	if d.meta.Progress.TotalActivities > 0 {
		pdfTextCenter(p, "F2", 30, badgeCx, badgeCy+6, white, fmt.Sprintf("%.0f%%", d.meta.Progress.OverallPercent))
		pdfTextCenter(p, "F1", 8, badgeCx, badgeCy-14, white, "ACTIVITIES")
		pdfTextCenter(p, "F1", 8, badgeCx, badgeCy-25, white, "COMPLETE")
	} else {
		// A brand-new plan with nothing logged yet isn't "0% complete" in
		// any meaningful sense — that reads as a failing plan rather than
		// one that simply hasn't started. Say so plainly instead.
		pdfTextCenter(p, "F2", 15, badgeCx, badgeCy+10, white, "NEW PLAN")
		pdfTextCenter(p, "F1", 8, badgeCx, badgeCy-8, white, "NO ACTIVITIES")
		pdfTextCenter(p, "F1", 8, badgeCx, badgeCy-19, white, "YET")
	}

	// ── Org identity (logo if available, else just the name) top-left
	// within the band, and the platform credit top-right. The org name is
	// truncated against a fixed reservation for the platform credit block
	// — not against the badge, which sits much lower and isn't actually
	// adjacent to this text. ──
	const platformCreditReserve = 150
	orgNameMaxW := (pdfPageWidth - pdfMarginR - platformCreditReserve) - pdfMarginL
	orgNameY := pdfPageHeight - 46.0
	if d.logoID != 0 {
		lw, lh := d.logo.ptSize(30, 130)
		pdfImageDraw(p, "Logo", pdfMarginL, pdfPageHeight-30-lh, lw, lh)
		orgNameY = pdfPageHeight - 30 - lh - 16
	}
	pdfText(p, "F2", 13, pdfMarginL, orgNameY, white, truncateToWidth(d.meta.OrgName, orgNameMaxW, 13))

	pdfTextRight(p, "F2", 10.5, pdfPageWidth-pdfMarginR, pdfPageHeight-40, white, "SPE-Lite")
	pdfTextRight(p, "F1", 7.5, pdfPageWidth-pdfMarginR, pdfPageHeight-52, white, "by DGRV Eswatini")

	// ── Report type eyebrow + title, capped at 2 lines. Both start well
	// below the badge's bottom edge (badgeCy - badgeOuterR), so wrapping to
	// more lines only moves further away from it, never closer. ──
	y := leftBottomY - 60
	pdfText(p, "F1", 10.5, pdfMarginL, y, brandAccent, strings.ToUpper(d.meta.ReportTypeLabel))
	y -= 30
	titleLines := wrapText(asciiFold(d.meta.ReportTitle), charsForWidth(pdfContentW, 25))
	if len(titleLines) > 2 {
		titleLines = titleLines[:2]
		titleLines[1] = strings.TrimRight(titleLines[1], " ") + " .."
	}
	for _, ln := range titleLines {
		pdfText(p, "F2", 25, pdfMarginL, y, inkDark, ln)
		y -= 30
	}
	y -= 16

	// ── "Prepared By" masthead (accent bar + preparer name) ──
	pdfRect(p, pdfMarginL, y-16, 3, 36, brandAccent)
	pdfText(p, "F1", 9, pdfMarginL+14, y+6, inkMed, "Prepared By")
	pdfText(p, "F2", 13, pdfMarginL+14, y-11, inkDark, truncateToWidth(d.meta.GeneratedBy, pdfContentW-14, 13))
	y -= 56

	// ── Letterhead details — each value truncated to one line, so this
	// block has a fixed maximum height (7 rows) regardless of content. ──
	labelVal := func(label, val string) {
		if val == "" {
			return
		}
		pdfText(p, "F2", 9.5, pdfMarginL, y, inkMed, label)
		pdfText(p, "F1", 9.5, pdfMarginL+118, y, inkDark, truncateToWidth(val, pdfContentW-118, 9.5))
		y -= 17
	}
	labelVal("Organisation", d.meta.OrgName)
	labelVal("Industry", d.meta.OrgIndustry)
	labelVal("Location", d.meta.OrgLocation)
	labelVal("Contact", d.meta.OrgContact)
	labelVal("Plan Status", strings.ToUpper(d.meta.PlanStatus))
	labelVal("Generated On", d.meta.GeneratedAt.Format("02 January 2006, 15:04"))

	// ── Bottom wave band (two-tone, mirrored) ──
	pdfWaveBandBottom(p, 64, 118, tint(brandPrimary, 0.55))
	pdfWaveBandBottom(p, 50, 100, brandPrimary)

	// ── Confidentiality notice — always in the white area above the wave;
	// see the function doc comment for why this can't collide with it. ──
	const footY = 150.0
	pdfLine(p, pdfMarginL, footY, pdfPageWidth-pdfMarginR, footY, borderGray, 0.75)
	pdfText(p, "F1", 8.5, pdfMarginL, footY-20, inkLight, "CONFIDENTIAL - this document contains proprietary strategic planning")
	pdfText(p, "F1", 8.5, pdfMarginL, footY-32, inkLight, "information prepared solely for the addressed organisation.")

	pdfTextCenter(p, "F1", 8, pdfPageWidth/2, 24, white, "Generated by SPE-Lite - a strategic planning platform by DGRV Eswatini")
}

func (d *pdfDoc) heading(text string) {
	text = asciiFold(text)
	d.ensureSpace(36)
	d.y -= 4
	pdfRect(d.cur, pdfMarginL, d.y-3, 3, 15, brandAccent)
	pdfText(d.cur, "F2", 12.5, pdfMarginL+10, d.y, brandPrimary, text)
	d.y -= 7
	pdfLine(d.cur, pdfMarginL, d.y, pdfPageWidth-pdfMarginR, d.y, borderGray, 0.5)
	d.y -= 16
}

func (d *pdfDoc) paragraph(text string) {
	text = asciiFold(text)
	lines := wrapText(text, charsForWidth(pdfContentW, 9.5))
	for _, ln := range lines {
		d.ensureSpace(13)
		pdfText(d.cur, "F1", 9.5, pdfMarginL, d.y, inkDark, ln)
		d.y -= 13
	}
	d.y -= 6
}

func (d *pdfDoc) table(t *contentTable) {
	if t == nil || len(t.Headers) == 0 {
		return
	}
	n := len(t.Headers)

	// Fold to ASCII once, up front, and use these folded copies for both
	// the width weighting below and the actual drawing later — that's what
	// keeps the two in agreement. Measuring the original UTF-8 text (e.g.
	// a 3-byte "—") against len() while drawing a different, folded string
	// is exactly what let columns drift out of alignment before.
	headers := make([]string, n)
	for i, h := range t.Headers {
		headers[i] = asciiFold(h)
	}
	rows := make([][]string, len(t.Rows))
	for r, row := range t.Rows {
		folded := make([]string, len(row))
		for i, c := range row {
			folded[i] = asciiFold(c)
		}
		rows[r] = folded
	}

	weights := make([]float64, n)
	for i, h := range headers {
		weights[i] = float64(len(h))
	}
	for _, row := range rows {
		for i, c := range row {
			if i < n && float64(len(c)) > weights[i] {
				weights[i] = float64(len(c))
			}
		}
	}
	total := 0.0
	for _, wt := range weights {
		total += wt
	}
	if total == 0 {
		total = float64(n)
	}
	// minW is the narrowest a column is allowed to get before short
	// content like "In Progress" starts forcing every word onto its own
	// wrapped line. For pathologically wide tables (many columns) even
	// every column at 55pt wouldn't fit the page, so it's capped down to
	// an equal share of the content width in that case, rather than
	// letting the table overflow the page margin.
	minW := 55.0
	if minW*float64(n) > pdfContentW {
		minW = pdfContentW / float64(n)
	}

	colW := make([]float64, n)
	flexible := make([]bool, n)
	for i := range colW {
		colW[i] = weights[i] / total * pdfContentW
		if colW[i] < minW {
			colW[i] = minW
		}
		flexible[i] = true
	}

	// If flooring narrow columns pushed the total over the page width,
	// give the excess back only from columns that have room above the
	// floor — proportional to how far above it each one is — rather than
	// uniformly rescaling every column. A uniform rescale here was the
	// original bug: it would shrink already-floored columns back below
	// minW right after they'd been raised to it, so a table with several
	// narrow columns next to one wide one could end up squeezing the
	// narrow ones down to single characters per line. Bounded to n passes
	// since each pass permanently floors at least one more column.
	for pass := 0; pass < n; pass++ {
		sum := 0.0
		for _, cw := range colW {
			sum += cw
		}
		excess := sum - pdfContentW
		if excess <= 0.01 {
			break
		}
		slack := 0.0
		for i := range colW {
			if flexible[i] && colW[i] > minW {
				slack += colW[i] - minW
			}
		}
		if slack <= 0 {
			break // every column is already at the floor
		}
		anyFloored := false
		for i := range colW {
			if !flexible[i] || colW[i] <= minW {
				continue
			}
			colW[i] -= (colW[i] - minW) / slack * excess
			if colW[i] <= minW {
				colW[i] = minW
				flexible[i] = false
				anyFloored = true
			}
		}
		if !anyFloored {
			break // converged without any column needing another pass
		}
	}

	const fontSize = 8.0
	const pad = 4.0
	drawRow := func(cells []string, header, band bool) {
		cellLines := make([][]string, n)
		maxLines := 1
		for i := 0; i < n; i++ {
			var text string
			if i < len(cells) {
				text = cells[i]
			}
			chars := charsForWidth(colW[i]-2*pad, fontSize)
			cellLines[i] = wrapText(text, chars)
			// Cap how tall any single cell can force the row — without
			// this, one field with an unusually long value (a pasted
			// paragraph where a short indicator was expected, say) would
			// stretch the whole row's height, which reads as broken far
			// more than a clearly-truncated cell does.
			const maxCellLines = 6
			if len(cellLines[i]) > maxCellLines {
				cellLines[i] = cellLines[i][:maxCellLines]
				last := cellLines[i][maxCellLines-1]
				last = strings.TrimRight(last, " ")
				if len(last) > chars-2 {
					last = last[:chars-2]
				}
				cellLines[i][maxCellLines-1] = last + ".."
			}
			if len(cellLines[i]) > maxLines {
				maxLines = len(cellLines[i])
			}
		}
		rowH := float64(maxLines)*(fontSize+2.5) + 2*pad
		d.ensureSpace(rowH)

		if header {
			pdfRect(d.cur, pdfMarginL, d.y-rowH, pdfContentW, rowH, brandPrimary)
		} else if band {
			pdfRect(d.cur, pdfMarginL, d.y-rowH, pdfContentW, rowH, bandLight)
		}

		x := pdfMarginL
		for i := 0; i < n; i++ {
			textColor, font := inkDark, "F1"
			if header {
				textColor, font = white, "F2"
			}
			ty := d.y - pad - fontSize
			for _, ln := range cellLines[i] {
				pdfText(d.cur, font, fontSize, x+pad, ty, textColor, ln)
				ty -= fontSize + 2.5
			}
			x += colW[i]
		}

		x = pdfMarginL
		for i := 0; i <= n; i++ {
			pdfLine(d.cur, x, d.y, x, d.y-rowH, borderGray, 0.4)
			if i < n {
				x += colW[i]
			}
		}
		pdfLine(d.cur, pdfMarginL, d.y-rowH, pdfMarginL+pdfContentW, d.y-rowH, borderGray, 0.4)
		d.y -= rowH
	}

	drawRow(headers, true, false)
	for i, row := range rows {
		drawRow(row, false, i%2 == 1)
	}
	d.y -= 10
}

// chartBarColor maps a bar's threshold hint onto the same red/yellow/green
// palette TrackingModule.tsx uses (bad <=50%, good >=75%, warn between) so
// a report's charts read the same way the in-app gauges do. "" (no hint,
// e.g. a budget-allocation chart with no pass/fail meaning) uses the brand
// colour instead of a traffic-light one.
func chartBarColor(hint string) [3]float64 {
	switch hint {
	case "good":
		return [3]float64{0.13, 0.55, 0.13} // green
	case "warn":
		return [3]float64{0.85, 0.60, 0.0} // amber
	case "bad":
		return [3]float64{0.80, 0.15, 0.15} // red
	default:
		return brandPrimary
	}
}

// truncateToWidth returns s (ASCII-folded) if it already fits within
// widthPt at the given fontSize, using the same average-glyph-width
// heuristic as charsForWidth (there's no font-metrics table in this
// hand-rolled renderer) — otherwise a shortened copy ending in ".." (ASCII,
// same reasoning as asciiFold: an ellipsis glyph would just come back out
// as "?"). Used anywhere a single line of untrusted-length text (an org
// name, a contact string, ...) has to fit in a fixed space without
// wrapping — e.g. the cover page's letterhead details in buildCover.
func truncateToWidth(s string, widthPt, fontSize float64) string {
	s = asciiFold(s)
	maxChars := charsForWidth(widthPt, fontSize)
	if len(s) <= maxChars {
		return s
	}
	if maxChars <= 2 {
		return s[:maxChars]
	}
	return s[:maxChars-2] + ".."
}

// truncateLabel keeps a bar label from overrunning its column. Chart bar
// labels are always drawn at size 8 (see chart() below), which is what the
// original hardcoded "8 * 0.5" heuristic here was calibrated for — this is
// now just that fixed case of the general truncateToWidth above.
func truncateLabel(s string, widthPt float64) string {
	return truncateToWidth(s, widthPt, 8)
}

// chart draws a horizontal bar chart: one row per bar, a track background,
// a filled portion proportional to Value/Max, and a trailing value label.
// Used for the KPI achievement scorecard today, but generic enough for any
// future 0..Max metric (budget allocation, membership counts, etc.).
func (d *pdfDoc) chart(c *contentChart) {
	if c == nil || len(c.Bars) == 0 {
		return
	}
	const barH = 15.0
	const rowGap = 6.0
	const labelW = 150.0
	const valueW = 44.0
	trackX := pdfMarginL + labelW
	trackW := pdfContentW - labelW - valueW
	max := c.Max
	if max <= 0 {
		max = 100
	}

	d.ensureSpace(18)
	if c.Title != "" {
		pdfText(d.cur, "F2", 9, pdfMarginL, d.y, inkDark, c.Title)
		d.y -= 16
	}

	for _, b := range c.Bars {
		d.ensureSpace(barH + rowGap)
		rowTop := d.y
		labelY := rowTop - barH + 4.5

		pdfText(d.cur, "F1", 8, pdfMarginL, labelY, inkDark, truncateLabel(b.Label, labelW-6))
		pdfRect(d.cur, trackX, rowTop-barH, trackW, barH-3, bandLight)

		frac := b.Value / max
		if frac < 0 {
			frac = 0
		}
		if frac > 1 {
			frac = 1
		}
		if frac > 0 {
			pdfRect(d.cur, trackX, rowTop-barH, trackW*frac, barH-3, chartBarColor(b.ColorHint))
		}

		valText := fmt.Sprintf("%.0f%s", b.Value, c.Unit)
		pdfText(d.cur, "F2", 8, trackX+trackW+6, labelY, inkDark, valText)

		d.y -= barH + rowGap
	}
	d.y -= 8
}

func (d *pdfDoc) build() []byte {
	total := len(d.pages)
	for i, p := range d.pages {
		d.footer(p, i+1, total)
	}

	res := resourcesDict(d.fontReg, d.fontBold, d.logoID)

	var kidIDs []int
	coverContentID := d.w.addContentStream(d.cover.ops)
	kidIDs = append(kidIDs, d.w.addPage(d.pagesID, res, coverContentID))
	for _, p := range d.pages {
		cID := d.w.addContentStream(p.ops)
		kidIDs = append(kidIDs, d.w.addPage(d.pagesID, res, cID))
	}

	kids := make([]string, len(kidIDs))
	for i, id := range kidIDs {
		kids[i] = fmt.Sprintf("%d 0 R", id)
	}
	d.w.set(d.pagesID, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(kidIDs)))
	d.w.set(d.catalogID, fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", d.pagesID))
	return d.w.build(d.catalogID)
}

func renderPDF(meta reportMeta, rc *reportContent, logo *pdfLogo) ([]byte, error) {
	d := newPDFDoc(meta, logo)
	if len(rc.Sections) == 0 {
		d.paragraph("This report has no sections to display.")
	}
	for _, sec := range rc.Sections {
		d.heading(sec.Heading)
		for _, p := range sec.Paragraphs {
			d.paragraph(p)
		}
		if sec.Table != nil {
			d.table(sec.Table)
		}
		if sec.Chart != nil {
			d.chart(sec.Chart)
		}
	}
	return d.build(), nil
}

// escapePDFText escapes PDF string-literal special characters. Anything
// outside printable ASCII is first run through asciiFold (below) since
// we're using a standard Type1 font with no custom encoding — without
// that, ordinary content like an em-dash, a curly quote pasted from Word,
// or an accented name renders as a literal "?", and a report full of
// "missing data" placeholders (previously an em-dash) turned into a wall
// of "?" that read as broken rather than just incomplete.
func escapePDFText(s string) string {
	s = asciiFold(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '(' || r == ')' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r >= 32 && r < 127:
			b.WriteRune(r)
		default:
			// asciiFold already converted or dropped everything it knows
			// how to handle; whatever's left here (rare control chars,
			// unmapped scripts) is genuinely unsupported by this font —
			// drop it rather than emit a misleading "?".
		}
	}
	return b.String()
}

// isASCIIText reports whether s is already pure ASCII, so the common case
// (which is most report content) can skip asciiFold's rune-by-rune work.
func isASCIIText(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 128 {
			return false
		}
	}
	return true
}

// asciiFoldTable maps typographic Unicode punctuation and accented Latin
// letters (the characters actually likely to show up in report content —
// smart-quoted text pasted from Word, em-dashes, names with diacritics) to
// a plain-ASCII equivalent of the same rendered width where possible, so
// escapePDFText doesn't have to fall back to "?" for ordinary text.
var asciiFoldTable = map[rune]string{
	'\u2014': "-",                // em dash —
	'\u2013': "-",                // en dash –
	'\u2018': "'", '\u2019': "'", // curly single quotes ‘ ’
	'\u201c': `"`, '\u201d': `"`, // curly double quotes “ ”
	'\u2026': "...", // ellipsis …
	'\u2022': "-",   // bullet •
	'\u00a0': " ",   // non-breaking space
	// Accented Latin letters commonly seen in names/addresses.
	'á': "a", 'à': "a", 'â': "a", 'ä': "a", 'ã': "a", 'å': "a",
	'Á': "A", 'À': "A", 'Â': "A", 'Ä': "A", 'Ã': "A", 'Å': "A",
	'é': "e", 'è': "e", 'ê': "e", 'ë': "e",
	'É': "E", 'È': "E", 'Ê': "E", 'Ë': "E",
	'í': "i", 'ì': "i", 'î': "i", 'ï': "i",
	'Í': "I", 'Ì': "I", 'Î': "I", 'Ï': "I",
	'ó': "o", 'ò': "o", 'ô': "o", 'ö': "o", 'õ': "o",
	'Ó': "O", 'Ò': "O", 'Ô': "O", 'Ö': "O", 'Õ': "O",
	'ú': "u", 'ù': "u", 'û': "u", 'ü': "u",
	'Ú': "U", 'Ù': "U", 'Û': "U", 'Ü': "U",
	'ñ': "n", 'Ñ': "N",
	'ç': "c", 'Ç': "C",
	'ý': "y", 'ÿ': "y", 'Ý': "Y",
}

// asciiFold converts s to plain ASCII: known typographic punctuation and
// accented letters are mapped via asciiFoldTable, and any remaining
// non-ASCII rune (CJK, Arabic, emoji, anything else this hand-rolled Type1
// renderer can't display) is dropped rather than replaced with "?".
//
// This is also what keeps table/paragraph layout aligned: colW and
// wrapText below measure text with len() (a byte count), which only
// matches the rendered character count once text is ASCII. Folding text
// before that measurement — not just before drawing — is what makes the
// two agree; measuring the original UTF-8 (where a single "—" is 3 bytes
// but 1 rendered glyph) is what caused columns to drift.
func asciiFold(s string) string {
	if isASCIIText(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r < 128 {
			b.WriteRune(r)
			continue
		}
		if repl, ok := asciiFoldTable[r]; ok {
			b.WriteString(repl)
		}
	}
	return b.String()
}

// wrapText breaks s into lines of at most width characters, breaking on
// whitespace where possible. A single "word" longer than width on its own
// (a long hyphenated activity title, a KPI indicator with no spaces, a
// URL, ...) is hard-broken into width-sized chunks rather than left as one
// over-length line — without this, that one word would render wider than
// its column and visually spill into whatever's next to it, which is
// exactly the kind of overflow this function exists to prevent.
func wrapText(s string, width int) []string {
	if width < 1 {
		width = 1
	}
	words := strings.Fields(s)
	if len(words) == 0 {
		return []string{""}
	}
	var lines []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			lines = append(lines, cur.String())
			cur.Reset()
		}
	}
	for _, word := range words {
		for len(word) > width {
			// This single word alone doesn't fit on its own line — start
			// a fresh line for it (flushing whatever's pending) and
			// hard-break it chunk by chunk until what's left does fit.
			flush()
			lines = append(lines, word[:width])
			word = word[width:]
		}
		if cur.Len() > 0 && cur.Len()+1+len(word) > width {
			flush()
		}
		if cur.Len() > 0 {
			cur.WriteByte(' ')
		}
		cur.WriteString(word)
	}
	flush()
	return lines
}

// ── Shared: zip + XML escaping for DOCX/XLSX ────────────────────────────

func buildZip(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write(content); err != nil {
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

// ══════════════════════════════════════════════════════════════════════════
// DOCX
// ══════════════════════════════════════════════════════════════════════════

const docxContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`

const docxRootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const docxFontRun = `w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"`

func docxImageParagraph(logo *pdfLogo) string {
	if logo == nil {
		return ""
	}
	cx, cy := logo.emuSize(0.55, 1.7)
	if cx == 0 || cy == 0 {
		return ""
	}
	return `<w:p><w:r><w:drawing>` +
		`<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
		fmt.Sprintf(`<wp:extent cx="%d" cy="%d"/>`, cx, cy) +
		`<wp:docPr id="1" name="Logo"/>` +
		`<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
		`<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
		`<pic:nvPicPr><pic:cNvPr id="1" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
		`<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
		fmt.Sprintf(`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`, cx, cy) +
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

func docxTitle(text string) string {
	return `<w:p><w:pPr><w:spacing w:before="160" w:after="40"/></w:pPr>` +
		`<w:r><w:rPr><w:b/><w:color w:val="` + brandPrimaryHex + `"/><w:sz w:val="44"/><w:rFonts ` + docxFontRun + `/></w:rPr>` +
		`<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`
}

func docxSubtitle(text string) string {
	return `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>` +
		`<w:r><w:rPr><w:color w:val="` + inkMedHex + `"/><w:sz w:val="22"/><w:rFonts ` + docxFontRun + `/></w:rPr>` +
		`<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`
}

func docxMetaLine(label, val string) string {
	if val == "" {
		return ""
	}
	return `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>` +
		`<w:r><w:rPr><w:b/><w:sz w:val="19"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve">` + xmlEscape(label+":  ") + `</w:t></w:r>` +
		`<w:r><w:rPr><w:sz w:val="19"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve">` + xmlEscape(val) + `</w:t></w:r></w:p>`
}

func docxConfidentialityNote() string {
	return `<w:p><w:pPr><w:spacing w:before="220"/></w:pPr>` +
		`<w:r><w:rPr><w:i/><w:color w:val="` + inkLightHex + `"/><w:sz w:val="17"/><w:rFonts ` + docxFontRun + `/></w:rPr>` +
		`<w:t xml:space="preserve">CONFIDENTIAL — prepared solely for the addressed organisation. Distribution is restricted.</w:t></w:r></w:p>`
}

func docxPageBreak() string {
	return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
}

func docxHeading(text string) string {
	return `<w:p><w:pPr><w:spacing w:before="260" w:after="100"/>` +
		`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="` + brandPrimaryHex + `"/></w:pBdr></w:pPr>` +
		`<w:r><w:rPr><w:b/><w:color w:val="` + brandPrimaryHex + `"/><w:sz w:val="26"/><w:rFonts ` + docxFontRun + `/></w:rPr>` +
		`<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`
}

func docxParagraph(text string) string {
	return `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr>` +
		`<w:r><w:rPr><w:sz w:val="19"/><w:rFonts ` + docxFontRun + `/><w:color w:val="` + inkDarkHex + `"/></w:rPr>` +
		`<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`
}

func docxTableRow(cells []string, kind int) string {
	// kind: 0 = header, 1 = normal, 2 = banded
	var row bytes.Buffer
	row.WriteString(`<w:tr>`)
	shade := ""
	switch kind {
	case 0:
		shade = `<w:shd w:val="clear" w:fill="` + brandPrimaryHex + `"/>`
	case 2:
		shade = `<w:shd w:val="clear" w:fill="` + bandLightHex + `"/>`
	}
	for _, c := range cells {
		rPr := `<w:rPr><w:sz w:val="18"/><w:rFonts ` + docxFontRun + `/></w:rPr>`
		if kind == 0 {
			rPr = `<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:rFonts ` + docxFontRun + `/></w:rPr>`
		}
		row.WriteString(`<w:tc><w:tcPr><w:tcMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>` + shade + `</w:tcPr>` +
			`<w:p><w:r>` + rPr + `<w:t xml:space="preserve">` + xmlEscape(c) + `</w:t></w:r></w:p></w:tc>`)
	}
	row.WriteString(`</w:tr>`)
	return row.String()
}

func docxTable(t *contentTable) string {
	var body strings.Builder
	body.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>` +
		`<w:top w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/><w:left w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/>` +
		`<w:bottom w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/><w:right w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/>` +
		`<w:insideH w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/><w:insideV w:val="single" w:sz="4" w:color="` + borderGrayHex + `"/></w:tblBorders></w:tblPr>`)
	body.WriteString(docxTableRow(t.Headers, 0))
	for i, row := range t.Rows {
		kind := 1
		if i%2 == 1 {
			kind = 2
		}
		body.WriteString(docxTableRow(row, kind))
	}
	body.WriteString(`</w:tbl><w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`)
	return body.String()
}

// docxChartLine renders one bar of a chart as a fixed-width text line
// (label, a Unicode block-bar, the value) in a monospaced font so the bars
// actually line up — Word doesn't get an embedded chart object here (that's
// a much deeper slice of the OOXML chart schema than this hand-rolled
// renderer takes on), but the block-bar reads as a real bar chart at a
// glance, which is what the report needs.
func docxChartLine(text string, color string) string {
	c := color
	if c == "" {
		c = inkDarkHex
	}
	return `<w:p><w:pPr><w:spacing w:after="20"/></w:pPr>` +
		`<w:r><w:rPr><w:sz w:val="18"/><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="` + c + `"/></w:rPr>` +
		`<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`
}

// chartHexColor mirrors chartBarColor (render.go's PDF version) as hex, for
// the DOCX/XLSX text-bar renderers.
func chartHexColor(hint string) string {
	switch hint {
	case "good":
		return "228B22"
	case "warn":
		return "D99A00"
	case "bad":
		return "CC2626"
	default:
		return brandPrimaryHex
	}
}

const chartBarBlocks = 24

// chartBarLine builds the "Label  ████████░░░░  72%" text shared by the
// DOCX and XLSX chart renderers.
func chartBarLine(label string, value, max float64, unit string) string {
	if max <= 0 {
		max = 100
	}
	frac := value / max
	if frac < 0 {
		frac = 0
	}
	if frac > 1 {
		frac = 1
	}
	filled := int(frac * float64(chartBarBlocks))
	bar := strings.Repeat("\u2588", filled) + strings.Repeat("\u2591", chartBarBlocks-filled)
	name := label
	if len(name) > 22 {
		name = name[:21] + "."
	}
	return fmt.Sprintf("%-22s %s  %.0f%s", name, bar, value, unit)
}

func docxChart(c *contentChart) string {
	if c == nil || len(c.Bars) == 0 {
		return ""
	}
	var b strings.Builder
	if c.Title != "" {
		b.WriteString(docxParagraph(c.Title))
	}
	for _, bar := range c.Bars {
		b.WriteString(docxChartLine(chartBarLine(bar.Label, bar.Value, c.Max, c.Unit), chartHexColor(bar.ColorHint)))
	}
	b.WriteString(`<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`)
	return b.String()
}

func docxHeaderXML(orgName string) string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="` + borderGrayHex + `"/></w:pBdr>` +
		`<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>` +
		`<w:r><w:rPr><w:b/><w:color w:val="` + brandPrimaryHex + `"/><w:sz w:val="16"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve">SPE-Lite  </w:t></w:r>` +
		`<w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="16"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve">by DGRV Eswatini</w:t></w:r>` +
		`<w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="16"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:tab/><w:t xml:space="preserve">` + xmlEscape(orgName) + `</w:t></w:r>` +
		`</w:p></w:hdr>`
}

func docxFooterXML() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="` + borderGrayHex + `"/></w:pBdr>` +
		`<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>` +
		`<w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="15"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve">SPE-Lite by DGRV Eswatini — Confidential</w:t></w:r>` +
		`<w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="15"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:tab/><w:t xml:space="preserve">Page </w:t></w:r>` +
		`<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="15"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>` +
		`<w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="15"/><w:rFonts ` + docxFontRun + `/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r>` +
		`<w:fldSimple w:instr=" NUMPAGES "><w:r><w:rPr><w:color w:val="` + inkLightHex + `"/><w:sz w:val="15"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>` +
		`</w:p></w:ftr>`
}

func renderDOCX(meta reportMeta, rc *reportContent, logo *pdfLogo) ([]byte, error) {
	var cover strings.Builder
	cover.WriteString(docxImageParagraph(logo))
	cover.WriteString(docxTitle(meta.ReportTitle))
	cover.WriteString(docxSubtitle(meta.ReportTypeLabel))
	cover.WriteString(`<w:p/>`)
	cover.WriteString(docxMetaLine("Plan", meta.PlanTitle))
	cover.WriteString(docxMetaLine("Organisation", meta.OrgName))
	cover.WriteString(docxMetaLine("Industry", meta.OrgIndustry))
	cover.WriteString(docxMetaLine("Location", meta.OrgLocation))
	cover.WriteString(docxMetaLine("Contact", meta.OrgContact))
	cover.WriteString(docxMetaLine("Plan Status", strings.ToUpper(meta.PlanStatus)))
	cover.WriteString(docxMetaLine("Prepared By", meta.GeneratedBy))
	cover.WriteString(docxMetaLine("Generated On", meta.GeneratedAt.Format("02 January 2006, 15:04")))
	cover.WriteString(docxConfidentialityNote())
	cover.WriteString(docxPageBreak())

	var body strings.Builder
	if len(rc.Sections) == 0 {
		body.WriteString(docxParagraph("This report has no sections to display."))
	}
	for _, sec := range rc.Sections {
		body.WriteString(docxHeading(sec.Heading))
		for _, p := range sec.Paragraphs {
			body.WriteString(docxParagraph(p))
		}
		if sec.Table != nil && len(sec.Table.Headers) > 0 {
			body.WriteString(docxTable(sec.Table))
		}
		if sec.Chart != nil {
			body.WriteString(docxChart(sec.Chart))
		}
	}

	sectPr := `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>` +
		`<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720"/></w:sectPr>`

	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
		`<w:body>` + cover.String() + body.String() + sectPr + `</w:body></w:document>`

	relTargets := `<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
		`<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`
	if logo != nil {
		relTargets += `<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>`
	}
	documentRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + relTargets + `</Relationships>`

	files := map[string][]byte{
		"[Content_Types].xml":          []byte(docxContentTypes),
		"_rels/.rels":                  []byte(docxRootRels),
		"word/document.xml":            []byte(documentXML),
		"word/_rels/document.xml.rels": []byte(documentRels),
		"word/header1.xml":             []byte(docxHeaderXML(meta.OrgName)),
		"word/footer1.xml":             []byte(docxFooterXML()),
	}
	if logo != nil {
		files["word/media/image1.jpeg"] = logo.Bytes
	}
	return buildZip(files)
}

// ══════════════════════════════════════════════════════════════════════════
// XLSX
// ══════════════════════════════════════════════════════════════════════════

const xlsxContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

// xlsxStyles defines a small fixed style palette:
//
//	0 default   1 title   2 section-heading/meta   3 table header (navy/white)
//	4 bordered cell   5 bordered + banded cell
const xlsxStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="18"/><color rgb="FF1B3A63"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1B3A63"/><name val="Calibri"/></font>
<font><i/><sz val="9"/><color rgb="FF8A8F99"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B3A63"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F3F5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5D8DD"/></left><right style="thin"><color rgb="FFD5D8DD"/></right><top style="thin"><color rgb="FFD5D8DD"/></top><bottom style="thin"><color rgb="FFD5D8DD"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`

func renderXLSX(meta reportMeta, rc *reportContent) ([]byte, error) {
	rowIdx := 1
	var rows []string
	maxCols := 1

	addRow := func(cells []string, style int) {
		var cs []string
		for i, c := range cells {
			ref := colLetter(i) + fmt.Sprint(rowIdx)
			sAttr := ""
			if style != 0 {
				sAttr = fmt.Sprintf(` s="%d"`, style)
			}
			cs = append(cs, fmt.Sprintf(`<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, sAttr, xmlEscape(c)))
		}
		rows = append(rows, fmt.Sprintf(`<row r="%d">%s</row>`, rowIdx, strings.Join(cs, "")))
		rowIdx++
	}

	addRow([]string{meta.ReportTitle}, 1)
	addRow([]string{meta.ReportTypeLabel}, 4)
	addRow([]string{""}, 0)
	addRow([]string{"Organisation: " + meta.OrgName}, 0)
	if meta.OrgIndustry != "" {
		addRow([]string{"Industry: " + meta.OrgIndustry}, 0)
	}
	if meta.OrgLocation != "" {
		addRow([]string{"Location: " + meta.OrgLocation}, 0)
	}
	if meta.OrgContact != "" {
		addRow([]string{"Contact: " + meta.OrgContact}, 0)
	}
	addRow([]string{"Plan: " + meta.PlanTitle + "   |   Status: " + strings.ToUpper(meta.PlanStatus)}, 0)
	addRow([]string{"Prepared by " + meta.GeneratedBy + " on " + meta.GeneratedAt.Format("02 Jan 2006 15:04")}, 4)
	addRow([]string{"SPE-Lite by DGRV Eswatini \u2014 Confidential"}, 4)
	addRow([]string{""}, 0)

	if len(rc.Sections) == 0 {
		addRow([]string{"This report has no sections to display."}, 0)
	}
	for _, sec := range rc.Sections {
		addRow([]string{sec.Heading}, 2)
		for _, p := range sec.Paragraphs {
			addRow([]string{p}, 0)
		}
		if sec.Table != nil && len(sec.Table.Headers) > 0 {
			if len(sec.Table.Headers) > maxCols {
				maxCols = len(sec.Table.Headers)
			}
			addRow(sec.Table.Headers, 3)
			for i, row := range sec.Table.Rows {
				style := 4
				if i%2 == 1 {
					style = 5
				}
				addRow(row, style)
			}
		}
		if sec.Chart != nil && len(sec.Chart.Bars) > 0 {
			if maxCols < 3 {
				maxCols = 3
			}
			addRow([]string{sec.Chart.Title}, 2)
			for i, b := range sec.Chart.Bars {
				style := 4
				if i%2 == 1 {
					style = 5
				}
				frac := b.Value / sec.Chart.Max
				if sec.Chart.Max <= 0 {
					frac = b.Value / 100
				}
				if frac < 0 {
					frac = 0
				}
				if frac > 1 {
					frac = 1
				}
				filled := int(frac * chartBarBlocks)
				bar := strings.Repeat("\u2588", filled) + strings.Repeat("\u2591", chartBarBlocks-filled)
				addRow([]string{b.Label, bar, fmt.Sprintf("%.0f%s", b.Value, sec.Chart.Unit)}, style)
			}
		}
		addRow([]string{""}, 0)
	}

	var colsXML strings.Builder
	colsXML.WriteString("<cols>")
	for i := 0; i < maxCols; i++ {
		w := 22.0
		if i == 0 {
			w = 36.0
		}
		colsXML.WriteString(fmt.Sprintf(`<col min="%d" max="%d" width="%.1f" customWidth="1"/>`, i+1, i+1, w))
	}
	colsXML.WriteString("</cols>")

	sheetXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		colsXML.String() +
		`<sheetData>` + strings.Join(rows, "") + `</sheetData></worksheet>`

	files := map[string][]byte{
		"[Content_Types].xml":        []byte(xlsxContentTypes),
		"_rels/.rels":                []byte(xlsxRootRels),
		"xl/workbook.xml":            []byte(xlsxWorkbook),
		"xl/_rels/workbook.xml.rels": []byte(xlsxWorkbookRels),
		"xl/worksheets/sheet1.xml":   []byte(sheetXML),
		"xl/styles.xml":              []byte(xlsxStyles),
	}
	return buildZip(files)
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
