#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Download file helper
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filepath);
    fs.mkdir(dir, { recursive: true }).then(() => {
      const file = fs.createWriteStream(filepath);
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', reject);
    });
  });
}

async function createExactClone() {
  console.log('🚀 Creating EXACT pixel-perfect clone of Bounder.IO...');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1920, height: 1080 }
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to match a real browser
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('📄 Loading Bounder.IO homepage...');
    await page.goto('https://bounder.io/', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    
    // Wait for all animations and lazy loading
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Scroll to load all lazy images
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          
          if(totalHeight >= scrollHeight){
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 2000);
          }
        }, 100);
      });
    });
    
    console.log('🎨 Extracting complete page structure and styles...');
    
    // Extract EVERYTHING
    const pageData = await page.evaluate(() => {
      // Helper to get all CSS rules
      function getAllCSSRules() {
        let css = '';
        for (let sheet of document.styleSheets) {
          try {
            for (let rule of sheet.cssRules) {
              css += rule.cssText + '\n';
            }
          } catch (e) {
            // External stylesheets may block access
          }
        }
        return css;
      }
      
      // Get the complete HTML
      const html = document.documentElement.cloneNode(true);
      
      // Remove newsletter sections
      const newsletterSelectors = [
        '#collection-58aadb94e6f2e14e390f0fb0',
        '.newsletter-block',
        '.sqs-block-newsletter',
        'form[action*="newsletter"]',
        '.stay-informed',
        '[data-block-type="newsletter"]'
      ];
      
      newsletterSelectors.forEach(selector => {
        html.querySelectorAll(selector).forEach(el => {
          // Check if parent is only newsletter content
          let parent = el.parentElement;
          while (parent && parent.tagName !== 'SECTION' && parent.tagName !== 'BODY') {
            const hasOtherContent = Array.from(parent.children).some(child => {
              return !newsletterSelectors.some(sel => child.matches(sel));
            });
            if (!hasOtherContent) {
              parent = parent.parentElement;
            } else {
              break;
            }
          }
          if (parent && parent.tagName === 'SECTION') {
            parent.remove();
          } else {
            el.remove();
          }
        });
      });
      
      // Remove API button
      html.querySelectorAll('.sqs-block-button-element').forEach(btn => {
        if (btn.textContent.trim().toUpperCase() === 'API') {
          const container = btn.closest('.sqs-block-button');
          if (container) container.remove();
        }
      });
      
      // Get all external stylesheets
      const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => link.href);
      
      // Get all images
      const images = new Set();
      html.querySelectorAll('img').forEach(img => {
        if (img.src) images.add(img.src);
        if (img.dataset.src) images.add(img.dataset.src);
        if (img.dataset.image) images.add(img.dataset.image);
      });
      
      html.querySelectorAll('[style*="background-image"]').forEach(el => {
        const match = el.style.backgroundImage.match(/url\(['"]?([^'")]+)['"]?\)/);
        if (match) images.add(match[1]);
      });
      
      // Get fonts
      const fonts = new Set();
      html.querySelectorAll('*').forEach(el => {
        const computed = window.getComputedStyle(el);
        if (computed.fontFamily) {
          fonts.add(computed.fontFamily);
        }
      });
      
      return {
        html: html.outerHTML,
        css: getAllCSSRules(),
        stylesheets: stylesheets,
        images: Array.from(images),
        fonts: Array.from(fonts),
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      };
    });
    
    console.log(`📊 Extracted ${pageData.images.length} images`);
    console.log(`🔤 Found ${pageData.fonts.length} font families`);
    console.log(`📑 Found ${pageData.stylesheets.length} stylesheets`);
    
    // Create the base HTML structure
    let finalHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageData.title}</title>
  
  <!-- Original Stylesheets -->
  ${pageData.stylesheets.map(url => `<link rel="stylesheet" href="${url}">`).join('\n  ')}
  
  <!-- Extracted Styles -->
  <style>
    ${pageData.css}
  </style>
  
  <!-- Override styles for GitHub Pages -->
  <style>
    /* Hide newsletter/subscribe elements */
    .newsletter-block,
    .sqs-block-newsletter,
    form[action*="newsletter"],
    form[action*="subscribe"],
    .stay-informed,
    #collection-58aadb94e6f2e14e390f0fb0 {
      display: none !important;
    }
    
    /* Fix navigation links */
    a[href="/contact"] { href: "contact.html"; }
    a[href="/privacy"] { href: "privacy.html"; }
    a[href="/terms"], a[href="/new-page"] { href: "terms.html"; }
    a[href="/"] { href: "index.html"; }
  </style>
</head>
${pageData.html.match(/<body[^>]*>[\s\S]*<\/body>/)[0]}
</html>`;
    
    // Process the HTML to fix links and assets
    finalHTML = finalHTML
      .replace(/href="\/contact"/g, 'href="contact.html"')
      .replace(/href="\/privacy"/g, 'href="privacy.html"')
      .replace(/href="\/terms"/g, 'href="terms.html"')
      .replace(/href="\/new-page"/g, 'href="terms.html"')
      .replace(/href="\/gallery-shift"/g, 'href="gallery-shift.html"')
      .replace(/href="\/ride-to-live-shift"/g, 'href="ride-to-live-shift.html"')
      .replace(/href="\/"/g, 'href="index.html"');
    
    // Save the homepage
    await fs.writeFile(path.join(__dirname, 'docs', 'index.html'), finalHTML);
    console.log('✅ Homepage saved');
    
    // Process other pages
    const otherPages = [
      { url: 'https://bounder.io/contact', file: 'contact.html' },
      { url: 'https://bounder.io/privacy', file: 'privacy.html' },
      { url: 'https://bounder.io/terms', file: 'terms.html' },
      { url: 'https://bounder.io/gallery-shift', file: 'gallery-shift.html' },
      { url: 'https://bounder.io/ride-to-live-shift', file: 'ride-to-live-shift.html' }
    ];
    
    for (const pageInfo of otherPages) {
      console.log(`\n📄 Processing ${pageInfo.url}...`);
      
      await page.goto(pageInfo.url, { 
        waitUntil: 'networkidle0',
        timeout: 60000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const pageHTML = await page.evaluate(() => {
        const html = document.documentElement.cloneNode(true);
        
        // Remove newsletter
        const newsletterSelectors = [
          '#collection-58aadb94e6f2e14e390f0fb0',
          '.newsletter-block',
          '.sqs-block-newsletter',
          'form[action*="newsletter"]',
          '.stay-informed'
        ];
        
        newsletterSelectors.forEach(selector => {
          html.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        // Remove API button
        html.querySelectorAll('.sqs-block-button-element').forEach(btn => {
          if (btn.textContent.trim().toUpperCase() === 'API') {
            btn.closest('.sqs-block-button')?.remove();
          }
        });
        
        return html.outerHTML;
      });
      
      // Fix links
      let processedHTML = '<!DOCTYPE html>\n' + pageHTML;
      processedHTML = processedHTML
        .replace(/href="\/contact"/g, 'href="contact.html"')
        .replace(/href="\/privacy"/g, 'href="privacy.html"')
        .replace(/href="\/terms"/g, 'href="terms.html"')
        .replace(/href="\/new-page"/g, 'href="terms.html"')
        .replace(/href="\/gallery-shift"/g, 'href="gallery-shift.html"')
        .replace(/href="\/ride-to-live-shift"/g, 'href="ride-to-live-shift.html"')
        .replace(/href="\/"/g, 'href="index.html"');
      
      // Special handling for contact page
      if (pageInfo.file === 'contact.html') {
        // Replace form action with Formspree
        processedHTML = processedHTML.replace(
          /<form[^>]*action="[^"]*"[^>]*>/g,
          '<form action="https://formspree.io/f/xwpkbzvr" method="POST">'
        );
      }
      
      await fs.writeFile(path.join(__dirname, 'docs', pageInfo.file), processedHTML);
      console.log(`✅ ${pageInfo.file} saved`);
    }
    
    // Download critical images
    console.log('\n🖼️ Downloading critical images...');
    await fs.mkdir(path.join(__dirname, 'docs', 'images'), { recursive: true });
    
    const imagesToDownload = [
      {
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1437403987855-UZEGF7VV4UCP5MQ7E5MI/drone-698564.jpg',
        path: 'docs/images/hero-drone.jpg'
      },
      {
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1445504408960-E2D03KMUU702FACTERIK/bounder-logo-horizontal-transparent-white.png',
        path: 'docs/images/logo.png'
      },
      {
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1445504344975-2TYLEY2NROAK5UFTNU4D/favicon.ico',
        path: 'docs/favicon.ico'
      }
    ];
    
    for (const img of imagesToDownload) {
      try {
        await downloadFile(img.url, path.join(__dirname, img.path));
        console.log(`✅ Downloaded ${img.path}`);
      } catch (err) {
        console.log(`⚠️ Could not download ${img.url}`);
      }
    }
    
    console.log('\n🎉 EXACT clone complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Test the site locally: node test-site.mjs');
    console.log('2. Commit and push to GitHub');
    console.log('3. Your site will be live at https://nellinc.github.io/Bounder/');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

createExactClone().catch(console.error);