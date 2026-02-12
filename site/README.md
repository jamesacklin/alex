# Alex Marketing Landing Page

A standalone HTML/CSS/JS landing page for Alex, the self-hosted PDF/EPUB reader.

## Design

**Editorial/Literary Modernism** - refined, warm, trustworthy aesthetic inspired by traditional libraries and modern technical precision.

### Key Elements
- **Typography**: Fraunces (display) + Manrope (body)
- **Colors**: Warm library palette (cream, brown, gold)
- **Effects**: Paper texture, parallax scroll, fade-in animations
- **Layout**: Asymmetric numbered sections, generous whitespace

## Usage

This is a completely standalone site with no dependencies or build steps.

### Local Development

Serve the site with any static server:

```bash
# Python 3
python3 -m http.server 8000

# Node.js (if http-server is installed)
npx http-server

# PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

### Deployment

Upload the entire `/site/` folder to any static host:
- Netlify (drag & drop)
- Vercel
- GitHub Pages
- AWS S3
- Cloudflare Pages
- Any web server

### Customization

- **Colors**: Edit CSS variables in `style.css` (`:root` section)
- **Content**: Edit text directly in `index.html`
- **Images**: Replace files in `images/` folder
- **Links**: Update GitHub and documentation URLs in HTML

## File Structure

```
site/
├── index.html          # Main page
├── style.css          # All styles
├── script.js          # Scroll animations
├── images/
│   ├── app-screenshot.jpg
│   └── library-bg.jpg
└── README.md          # This file
```

## Features

- Fully responsive (mobile, tablet, desktop)
- Smooth scroll animations
- Parallax hero background
- Intersection Observer for fade-ins
- Semantic HTML
- No dependencies, no build step
- Fast loading with optimized images

## Browser Support

Works in all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Uses:
- CSS Grid & Flexbox
- CSS Custom Properties
- Intersection Observer API
- requestAnimationFrame

## Performance Tips

1. **Optimize images** - Compress before uploading
2. **Add caching headers** on your server
3. **Enable gzip/brotli** compression
4. **Consider CDN** for global distribution

## License

Same license as Alex project (MIT)
