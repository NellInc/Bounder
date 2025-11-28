# SEO Optimization Plan for Bounder.io

## Current State Summary

**Site:** www.bounder.io (Drone geofencing technology)
**Platform:** Static HTML on GitHub Pages
**Pages:** 6 main pages (index, contact, privacy, terms, gallery, blog post)

---

## Priority 1: Critical Fixes (Immediate Impact)

### 1.1 Create robots.txt
**Impact:** High | **Effort:** Low

```txt
User-agent: *
Allow: /

Sitemap: https://www.bounder.io/sitemap.xml
```

**Location:** `/docs/robots.txt`

---

### 1.2 Create sitemap.xml
**Impact:** High | **Effort:** Low

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.bounder.io/</loc>
    <priority>1.0</priority>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>https://www.bounder.io/contact.html</loc>
    <priority>0.8</priority>
    <changefreq>monthly</changefreq>
  </url>
  <url>
    <loc>https://www.bounder.io/gallery-shift.html</loc>
    <priority>0.7</priority>
    <changefreq>monthly</changefreq>
  </url>
  <url>
    <loc>https://www.bounder.io/ride-to-live-shift.html</loc>
    <priority>0.6</priority>
    <changefreq>monthly</changefreq>
  </url>
  <url>
    <loc>https://www.bounder.io/privacy.html</loc>
    <priority>0.3</priority>
    <changefreq>yearly</changefreq>
  </url>
  <url>
    <loc>https://www.bounder.io/terms.html</loc>
    <priority>0.3</priority>
    <changefreq>yearly</changefreq>
  </url>
</urlset>
```

**Location:** `/docs/sitemap.xml`

---

### 1.3 Add Meta Descriptions (All Pages)
**Impact:** High | **Effort:** Medium

| Page | Current | Recommended |
|------|---------|-------------|
| **index.html** | Empty | "Bounder provides drone geofencing technology for events, venues, and restricted airspace. Track and enforce no-fly zones in real-time." |
| **contact.html** | Empty | "Contact Bounder for drone geofencing solutions. Get in touch to protect your event, venue, or airspace from unauthorized drones." |
| **gallery-shift.html** | Empty | "See Bounder's drone detection technology in action at SHIFT festival and other major events. View our gallery of successful deployments." |
| **ride-to-live-shift.html** | "Ride to Live" | "Bounder protected Ride to Live at SHIFT festival with real-time drone tracking and geofencing technology. Read the case study." |
| **privacy.html** | Empty | "Bounder privacy policy. Learn how we collect, use, and protect your data when using our drone geofencing services." |
| **terms.html** | Empty | "Terms of service for Bounder drone geofencing technology. Read our service agreement and usage terms." |

---

### 1.4 Fix Canonical URLs
**Impact:** High | **Effort:** Medium

**Problem:** Canonicals point to old Squarespace domain
**Solution:** Update all canonical links to GitHub Pages domain

**Change from:**
```html
<link rel="canonical" href="http://www.bounder.io/privacy">
```

**Change to:**
```html
<link rel="canonical" href="https://www.bounder.io/privacy.html">
```

**Files to update:**
- `/docs/index.html`
- `/docs/contact.html`
- `/docs/privacy.html`
- `/docs/terms.html`
- `/docs/gallery-shift.html`
- `/docs/ride-to-live-shift.html`

---

### 1.5 Fix 404.html File Size
**Impact:** High | **Effort:** Medium

**Problem:** 404.html is 7.9MB (extremely large)
**Target:** Under 100KB
**Solution:** Remove bloated assets, simplify page

---

## Priority 2: High-Value Improvements

### 2.1 Consolidate H1 Tags
**Impact:** Medium | **Effort:** Low

**Problem:** Multiple H1 tags on homepage
**Solution:** Single H1 per page, use H2-H6 for subsections

**Homepage H1 (keep):**
```html
<h1>Bounder tracks drones at your event to enforce no-fly zones</h1>
```

**Change other H1s to H2:**
- "Drones are a fantastic tool when used responsibly" → H2
- "How Bounder Works" → H2

---

### 2.2 Add Alt Text to All Images
**Impact:** Medium | **Effort:** Medium

**Current:** ~5 images have alt text, ~20+ have empty or missing alt
**Target:** 100% coverage with descriptive, keyword-rich alt text

**Examples:**
```html
<!-- Before -->
<img src="drone-detection.jpg" alt="">

<!-- After -->
<img src="drone-detection.jpg" alt="Bounder drone detection system tracking unauthorized UAV at outdoor event">
```

---

### 2.3 Add Preconnect/Prefetch Resource Hints
**Impact:** Medium | **Effort:** Low

Add to `<head>` of all pages:
```html
<link rel="preconnect" href="https://images.squarespace-cdn.com">
<link rel="preconnect" href="https://use.typekit.net">
<link rel="dns-prefetch" href="https://images.squarespace-cdn.com">
<link rel="dns-prefetch" href="https://use.typekit.net">
```

---

### 2.4 Optimize Font Loading
**Impact:** Medium | **Effort:** Medium

**Problem:** Typekit fonts block rendering
**Solution:** Add font-display: swap

```html
<link rel="preload" href="https://use.typekit.net/[id].css" as="style">
```

Or consider self-hosting critical fonts.

---

### 2.5 Update Structured Data (JSON-LD)
**Impact:** Medium | **Effort:** Low

**Current issues:**
- Uses Squarespace CDN image URLs
- Missing Organization schema
- Missing LocalBusiness schema (if applicable)

**Enhanced schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Bounder",
  "description": "Technology for making sure drones stay only where they belong",
  "url": "https://www.bounder.io",
  "logo": "https://www.bounder.io/assets/images/logo.png",
  "sameAs": [
    "https://twitter.com/bounderio",
    "https://linkedin.com/company/bounder"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "url": "https://www.bounder.io/contact.html"
  }
}
```

---

### 2.6 Add Breadcrumb Schema
**Impact:** Medium | **Effort:** Medium

For subpages like gallery and blog posts:
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [{
    "@type": "ListItem",
    "position": 1,
    "name": "Home",
    "item": "https://www.bounder.io/"
  },{
    "@type": "ListItem",
    "position": 2,
    "name": "Gallery",
    "item": "https://www.bounder.io/gallery-shift.html"
  }]
}
```

---

## Priority 3: Performance & Technical Improvements

### 3.1 Image Optimization
**Impact:** Medium | **Effort:** High

- Convert images to WebP format (30-50% smaller)
- Host critical images locally instead of Squarespace CDN
- Implement proper lazy loading on all below-fold images
- Add width/height attributes to prevent CLS

---

### 3.2 Clean Up Squarespace Legacy Code
**Impact:** Low | **Effort:** High

- Remove unused Squarespace classes from `<body>` tag
- Move inline styles to external CSS
- Remove data-* attributes not being used
- Minify HTML files

---

### 3.3 Add Open Graph Image Dimensions
**Impact:** Low | **Effort:** Low

```html
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```

---

### 3.4 Implement Core Web Vitals Improvements
**Impact:** Medium | **Effort:** High

- **LCP (Largest Contentful Paint):** Preload hero images
- **FID (First Input Delay):** Defer non-critical JS
- **CLS (Cumulative Layout Shift):** Add image dimensions

---

## Implementation Checklist

### Phase 1: Quick Wins (1-2 hours)
- [ ] Create robots.txt
- [ ] Create sitemap.xml
- [ ] Add meta descriptions to all 6 pages
- [ ] Add preconnect/prefetch hints
- [ ] Fix canonical URLs (http → https, add .html)

### Phase 2: Content & Structure (2-4 hours)
- [ ] Consolidate H1 tags on homepage
- [ ] Add alt text to all images
- [ ] Update JSON-LD structured data
- [ ] Add breadcrumb schema to subpages
- [ ] Fix 404.html file size

### Phase 3: Performance (4-8 hours)
- [ ] Convert images to WebP
- [ ] Self-host critical fonts
- [ ] Clean up Squarespace legacy code
- [ ] Minify HTML/CSS/JS
- [ ] Add width/height to images

---

## Post-Implementation

### Submit to Search Engines
1. Google Search Console: Submit sitemap.xml
2. Bing Webmaster Tools: Submit sitemap.xml
3. Request re-indexing of updated pages

### Monitor Results
- Track rankings for target keywords:
  - "drone geofencing"
  - "drone detection events"
  - "no-fly zone enforcement"
  - "event drone security"
- Monitor Core Web Vitals in Search Console
- Check crawl stats for indexing issues

---

## Expected Impact

| Metric | Current | Expected After |
|--------|---------|----------------|
| Indexed Pages | Unknown | 6 pages |
| Meta Description Coverage | 17% | 100% |
| Alt Text Coverage | ~25% | 100% |
| Page Speed Score | ~60 | ~80+ |
| Crawlability | Poor | Excellent |

---

*Plan created: 2025-11-28*
