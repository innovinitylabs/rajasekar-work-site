# rajasekar-work-site

`resume-data.json` is the single source of truth for the website and ATS resume.

After editing it, regenerate the checked-in HTML:

```bash
npm run build
```

Run the full acceptance suite before publishing:

```bash
npm run verify
```

The verification suite checks:

- generated website and printable HTML content
- conventional ATS section order
- required Data Engineer keywords
- one-page jsPDF output
- selectable PDF text and extraction order

Rendering paths:

- `build.js` generates `index.html` and `resume-source.html`
- `resume-pdf.js` generates the downloadable PDF
- `script.js` handles browser interactions and invokes the PDF renderer

Vercel runs `npm run build` during deployment.
