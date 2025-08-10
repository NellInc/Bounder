#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to download files
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function extractEverything() {
  console.log('🚀 Starting VERBATIM Bounder.IO extraction...');
  
  const browser = await puppeteer.launch({ 
    headless: false, // Watch it happen
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1920, height: 1080 }
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to Bounder.IO
    console.log('📄 Loading Bounder.IO...');
    await page.goto('https://bounder.io/', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    
    // Wait for everything to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔍 Extracting EVERYTHING from the page...');
    
    // Extract ALL computed styles and content
    const pageData = await page.evaluate(() => {
      const data = {
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        elements: [],
        fonts: new Set(),
        colors: new Set(),
        images: new Set(),
        text: []
      };
      
      // Get every single element
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach((element, index) => {
        const computed = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        
        // Skip hidden elements
        if (computed.display === 'none' || computed.visibility === 'hidden') return;
        
        const elementData = {
          tagName: element.tagName.toLowerCase(),
          className: element.className,
          id: element.id,
          index: index,
          text: element.textContent?.trim(),
          innerHTML: element.innerHTML,
          attributes: {},
          styles: {},
          position: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y
          }
        };
        
        // Get all attributes
        for (let attr of element.attributes) {
          elementData.attributes[attr.name] = attr.value;
        }
        
        // Get ALL computed styles
        const importantStyles = [
          'position', 'display', 'width', 'height', 'top', 'left', 'right', 'bottom',
          'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
          'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'color', 'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize', 'backgroundRepeat',
          'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
          'border', 'borderRadius', 'boxShadow', 'opacity', 'zIndex',
          'transform', 'transition', 'animation',
          'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
          'gridTemplateColumns', 'gridTemplateRows', 'gridGap'
        ];
        
        importantStyles.forEach(prop => {
          if (computed[prop] && computed[prop] !== 'none' && computed[prop] !== 'auto') {
            elementData.styles[prop] = computed[prop];
          }
        });
        
        // Collect fonts
        if (computed.fontFamily) {
          data.fonts.add(computed.fontFamily);
        }
        
        // Collect colors
        if (computed.color) data.colors.add(computed.color);
        if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          data.colors.add(computed.backgroundColor);
        }
        
        // Collect images
        if (element.tagName === 'IMG' && element.src) {
          data.images.add(element.src);
        }
        if (computed.backgroundImage && computed.backgroundImage !== 'none') {
          const match = computed.backgroundImage.match(/url\(['"]?([^'")]+)['"]?\)/);
          if (match) data.images.add(match[1]);
        }
        
        data.elements.push(elementData);
      });
      
      // Convert sets to arrays
      data.fonts = Array.from(data.fonts);
      data.colors = Array.from(data.colors);
      data.images = Array.from(data.images);
      
      return data;
    });
    
    console.log(`📊 Extracted ${pageData.elements.length} elements`);
    console.log(`🎨 Found ${pageData.colors.length} unique colors`);
    console.log(`🔤 Found ${pageData.fonts.length} unique fonts`);
    console.log(`🖼️ Found ${pageData.images.length} images`);
    
    // Save the raw data
    await fs.writeFile(
      path.join(__dirname, 'extracted-data.json'), 
      JSON.stringify(pageData, null, 2)
    );
    
    // Now extract the EXACT HTML structure
    console.log('📝 Extracting exact HTML structure...');
    
    const exactHTML = await page.evaluate(() => {
      // Remove newsletter sections
      const newsletterSelectors = [
        '#collection-58aadb94e6f2e14e390f0fb0',
        '.newsletter-block',
        '.sqs-block-newsletter',
        'form[action*="newsletter"]',
        '.stay-informed'
      ];
      
      newsletterSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      // Remove API button
      document.querySelectorAll('.sqs-block-button-element').forEach(btn => {
        if (btn.textContent.trim().toUpperCase() === 'API') {
          btn.closest('.sqs-block-button')?.remove();
        }
      });
      
      return document.documentElement.outerHTML;
    });
    
    // Process each page
    const pages = [
      { url: 'https://bounder.io/', file: 'index.html' },
      { url: 'https://bounder.io/contact', file: 'contact.html' },
      { url: 'https://bounder.io/privacy', file: 'privacy.html' },
      { url: 'https://bounder.io/terms', file: 'terms.html' }
    ];
    
    for (const pageInfo of pages) {
      console.log(`\n📄 Processing ${pageInfo.url}...`);
      
      if (pageInfo.url !== 'https://bounder.io/') {
        await page.goto(pageInfo.url, { 
          waitUntil: 'networkidle0',
          timeout: 60000 
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Get the complete page with all styles
      const fullHTML = await page.evaluate(() => {
        // Clone the document
        const html = document.documentElement.cloneNode(true);
        
        // Remove newsletter stuff
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
        
        // Fix asset URLs to be absolute
        html.querySelectorAll('img').forEach(img => {
          if (img.src && !img.src.startsWith('http')) {
            img.src = new URL(img.src, 'https://bounder.io/').href;
          }
          if (img.dataset.src && !img.dataset.src.startsWith('http')) {
            img.dataset.src = new URL(img.dataset.src, 'https://bounder.io/').href;
          }
        });
        
        html.querySelectorAll('link').forEach(link => {
          if (link.href && !link.href.startsWith('http')) {
            link.href = new URL(link.href, 'https://bounder.io/').href;
          }
        });
        
        html.querySelectorAll('script').forEach(script => {
          if (script.src && !script.src.startsWith('http')) {
            script.src = new URL(script.src, 'https://bounder.io/').href;
          }
        });
        
        // Fix internal navigation links
        html.querySelectorAll('a[href]').forEach(link => {
          const href = link.getAttribute('href');
          if (href === '/contact') link.setAttribute('href', 'contact.html');
          else if (href === '/privacy') link.setAttribute('href', 'privacy.html');
          else if (href === '/terms' || href === '/new-page') link.setAttribute('href', 'terms.html');
          else if (href === '/') link.setAttribute('href', 'index.html');
        });
        
        return html.outerHTML;
      });
      
      // Save the page
      await fs.writeFile(
        path.join(__dirname, 'docs', pageInfo.file),
        '<!DOCTYPE html>\n' + fullHTML
      );
      console.log(`✅ Saved ${pageInfo.file}`);
    }
    
    // Download critical assets
    console.log('\n📦 Downloading critical assets...');
    await fs.mkdir(path.join(__dirname, 'docs', 'assets'), { recursive: true });
    
    const criticalAssets = [
      {
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1437403987855-UZEGF7VV4UCP5MQ7E5MI/drone-698564.jpg',
        path: 'docs/assets/hero-drone.jpg'
      },
      {
        url: 'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1445504408960-E2D03KMUU702FACTERIK/bounder-logo-horizontal-transparent-white.png',
        path: 'docs/assets/logo.png'
      }
    ];
    
    for (const asset of criticalAssets) {
      try {
        await downloadFile(asset.url, path.join(__dirname, asset.path));
        console.log(`✅ Downloaded ${asset.path}`);
      } catch (err) {
        console.log(`⚠️ Could not download ${asset.url}`);
      }
    }
    
    console.log('\n🎉 VERBATIM clone complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

extractEverything().catch(console.error);