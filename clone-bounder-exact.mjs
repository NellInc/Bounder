#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';

async function cloneBounderExact() {
  console.log('🚀 Starting exact Bounder.IO clone...');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    // Pages to clone
    const pages = [
      { url: 'https://bounder.io/', file: 'index.html' },
      { url: 'https://bounder.io/contact', file: 'contact.html' },
      { url: 'https://bounder.io/privacy', file: 'privacy.html' },
      { url: 'https://bounder.io/terms', file: 'terms.html' },
      { url: 'https://bounder.io/gallery-shift', file: 'gallery-shift.html' },
      { url: 'https://bounder.io/ride-to-live-shift', file: 'ride-to-live-shift.html' }
    ];
    
    for (const pageInfo of pages) {
      console.log(`\n📄 Processing ${pageInfo.url}...`);
      
      const page = await browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      
      // Navigate and wait for full load
      await page.goto(pageInfo.url, { 
        waitUntil: 'networkidle0',
        timeout: 60000 
      });
      
      // Wait for any dynamic content
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the complete rendered HTML
      const html = await page.content();
      
      // Process the HTML
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      // Remove subscribe section completely
      const subscribeSelectors = [
        '#collection-58aadb94e6f2e14e390f0fb0',
        '.newsletter-block',
        '.sqs-block-newsletter',
        'form[action*="newsletter"]',
        'form[action*="subscribe"]',
        '[data-block-type="newsletter"]',
        '.stay-informed'
      ];
      
      subscribeSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          // Find parent section if it only contains the newsletter
          let parent = el.parentElement;
          while (parent && parent.tagName !== 'SECTION' && parent.tagName !== 'BODY') {
            parent = parent.parentElement;
          }
          
          // Check if parent section only has newsletter content
          if (parent && parent.tagName === 'SECTION') {
            const hasOtherContent = Array.from(parent.querySelectorAll('*')).some(child => {
              return !child.matches(subscribeSelectors.join(',')) && 
                     !child.querySelector(subscribeSelectors.join(',')) &&
                     child.textContent.trim().length > 0;
            });
            
            if (!hasOtherContent || parent.textContent.includes('Stay Informed')) {
              parent.remove();
              return;
            }
          }
          
          el.remove();
        });
      });
      
      // Remove API button but keep GitHub button
      const buttons = document.querySelectorAll('.sqs-block-button-element');
      buttons.forEach(button => {
        if (button.textContent.trim().toUpperCase() === 'API') {
          // Remove the entire button container
          let container = button.closest('.sqs-block-button');
          if (container) {
            container.remove();
          } else {
            button.remove();
          }
        }
      });
      
      // Fix all asset URLs to be absolute
      const fixUrls = (selector, attribute) => {
        document.querySelectorAll(selector).forEach(el => {
          const value = el.getAttribute(attribute);
          if (value && !value.startsWith('http') && !value.startsWith('data:')) {
            if (value.startsWith('//')) {
              el.setAttribute(attribute, 'https:' + value);
            } else if (value.startsWith('/')) {
              el.setAttribute(attribute, 'https://bounder.io' + value);
            }
          }
        });
      };
      
      fixUrls('img', 'src');
      fixUrls('img', 'data-src');
      fixUrls('img', 'data-image');
      fixUrls('link', 'href');
      fixUrls('script', 'src');
      fixUrls('source', 'srcset');
      fixUrls('video', 'src');
      fixUrls('iframe', 'src');
      
      // Fix background images in inline styles
      document.querySelectorAll('[style*="background-image"]').forEach(el => {
        let style = el.getAttribute('style');
        style = style.replace(/url\(['"]?(?!http)(?!data:)([^'")]+)['"]?\)/g, (match, url) => {
          if (url.startsWith('//')) {
            return `url('https:${url}')`;
          } else if (url.startsWith('/')) {
            return `url('https://bounder.io${url}')`;
          }
          return match;
        });
        el.setAttribute('style', style);
      });
      
      // Update navigation links for GitHub Pages
      const navLinks = document.querySelectorAll('a[href]');
      navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          // Convert Bounder.io internal links to relative
          if (href.includes('bounder.io/contact')) {
            link.setAttribute('href', 'contact.html');
          } else if (href.includes('bounder.io/privacy')) {
            link.setAttribute('href', 'privacy.html');
          } else if (href.includes('bounder.io/terms')) {
            link.setAttribute('href', 'terms.html');
          } else if (href.includes('bounder.io/gallery-shift')) {
            link.setAttribute('href', 'gallery-shift.html');
          } else if (href.includes('bounder.io/ride-to-live-shift')) {
            link.setAttribute('href', 'ride-to-live-shift.html');
          } else if (href === '/' || href === 'https://bounder.io' || href === 'https://bounder.io/') {
            link.setAttribute('href', 'index.html');
          }
        }
      });
      
      // Add custom styles to ensure exact match
      const customStyle = document.createElement('style');
      customStyle.textContent = `
        /* Hide newsletter/subscribe elements */
        .newsletter-block,
        .sqs-block-newsletter,
        form[action*="newsletter"],
        form[action*="subscribe"],
        .stay-informed,
        #collection-58aadb94e6f2e14e390f0fb0 {
          display: none !important;
        }
        
        /* Ensure proper footer spacing without newsletter */
        footer {
          margin-top: 80px !important;
        }
        
        /* Cookie banner adjustments for GitHub Pages */
        .cookie-banner-mount-point {
          z-index: 99999 !important;
        }
      `;
      document.head.appendChild(customStyle);
      
      // Special handling for contact page - preserve custom form
      if (pageInfo.file === 'contact.html') {
        const contactForm = document.querySelector('.sqs-block-form');
        if (contactForm) {
          // Replace with a simple contact form that works on GitHub Pages
          contactForm.innerHTML = `
            <div class="form-wrapper">
              <form action="https://formspree.io/f/YOUR_FORM_ID" method="POST" class="contact-form">
                <div class="form-item field">
                  <label class="title" for="name">Name <span class="required">*</span></label>
                  <input type="text" id="name" name="name" required>
                </div>
                
                <div class="form-item field">
                  <label class="title" for="email">Email Address <span class="required">*</span></label>
                  <input type="email" id="email" name="email" required>
                </div>
                
                <div class="form-item field">
                  <label class="title" for="phone">Phone</label>
                  <input type="tel" id="phone" name="phone">
                </div>
                
                <div class="form-item field">
                  <label class="title" for="message">Message <span class="required">*</span></label>
                  <textarea id="message" name="message" rows="5" required></textarea>
                </div>
                
                <div class="form-button-wrapper">
                  <button type="submit" class="button sqs-system-button sqs-editable-button">
                    Submit Enquiry
                  </button>
                </div>
              </form>
            </div>
          `;
        }
      }
      
      // Get the final HTML
      let finalHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      
      // Clean up the HTML
      finalHtml = finalHtml
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/>\s+</g, '><') // Remove whitespace between tags
        .replace(/<!--.*?-->/g, '') // Remove comments
        .trim();
      
      // Save to docs folder
      const outputPath = path.join(process.cwd(), 'docs', pageInfo.file);
      await fs.writeFile(outputPath, finalHtml, 'utf-8');
      console.log(`✅ Saved ${pageInfo.file}`);
      
      await page.close();
    }
    
    // Download critical assets
    console.log('\n📦 Downloading critical assets...');
    
    // Ensure images directory exists
    await fs.mkdir(path.join(process.cwd(), 'docs', 'images'), { recursive: true });
    
    // Download logo and favicon
    const assetsToDownload = [
      { 
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1567900254491-8D1NWCVQLC74ZMHGLUGV/Slana-logo-white+%281%29.png',
        path: 'docs/images/logo.png'
      },
      {
        url: 'https://bounder.io/favicon.ico',
        path: 'docs/favicon.ico'
      }
    ];
    
    const downloadPage = await browser.newPage();
    for (const asset of assetsToDownload) {
      try {
        const response = await downloadPage.goto(asset.url);
        const buffer = await response.buffer();
        await fs.writeFile(path.join(process.cwd(), asset.path), buffer);
        console.log(`✅ Downloaded ${asset.path}`);
      } catch (err) {
        console.log(`⚠️ Could not download ${asset.url}: ${err.message}`);
      }
    }
    
    console.log('\n🎉 Bounder.IO clone complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Update the Formspree form ID in contact.html');
    console.log('2. Test all pages locally');
    console.log('3. Commit and push to GitHub');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

cloneBounderExact().catch(console.error);