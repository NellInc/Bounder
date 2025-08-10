#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

async function downloadFile(url, filepath) {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
  
  return new Promise((resolve, reject) => {
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
}

async function perfectClone() {
  console.log('🚀 Starting PERFECT Bounder.IO clone...');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // First, get the homepage and extract ALL resources
    console.log('📄 Loading Bounder.IO homepage...');
    await page.goto('https://bounder.io/', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    
    // Wait for everything to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get ALL CSS files
    const cssFiles = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      return links.map(link => link.href);
    });
    
    // Get ALL JS files
    const jsFiles = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.map(script => script.src);
    });
    
    // Get ALL images
    const images = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const backgroundImages = Array.from(document.querySelectorAll('[style*="background-image"]'));
      
      const imgUrls = imgs.map(img => img.src || img.dataset.src || img.dataset.image).filter(Boolean);
      
      const bgUrls = backgroundImages.map(el => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?([^'")]+)['"]?\)/);
        return match ? match[1] : null;
      }).filter(Boolean);
      
      return [...new Set([...imgUrls, ...bgUrls])];
    });
    
    console.log(`📦 Found ${cssFiles.length} CSS files, ${jsFiles.length} JS files, ${images.length} images`);
    
    // Create docs directory structure
    await fs.mkdir('docs/assets/css', { recursive: true });
    await fs.mkdir('docs/assets/js', { recursive: true });
    await fs.mkdir('docs/assets/images', { recursive: true });
    await fs.mkdir('docs/assets/fonts', { recursive: true });
    
    // Download critical hero image
    console.log('🖼️ Downloading hero image...');
    try {
      await downloadFile(
        'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1437403987855-UZEGF7VV4UCP5MQ7E5MI/drone-698564.jpg',
        'docs/assets/images/hero-drone.jpg'
      );
    } catch (err) {
      console.log('⚠️ Could not download hero image');
    }
    
    // Download logo
    console.log('🎨 Downloading logo...');
    try {
      await downloadFile(
        'https://images.squarespace-cdn.com/content/v1/55acf641e4b0b8a3dbbdbd91/1445504408960-E2D03KMUU702FACTERIK/bounder-logo-horizontal-transparent-white.png',
        'docs/assets/images/logo.png'
      );
    } catch (err) {
      console.log('⚠️ Could not download logo');
    }
    
    // Get the complete HTML with all inline styles
    const html = await page.evaluate(() => {
      // Remove newsletter/subscribe elements
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
    
    // Create a clean HTML structure
    const cleanHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bounder</title>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  
  <style>
    /* Reset */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Proxima Nova', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    
    /* Header */
    .header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      padding: 30px 60px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .logo img {
      height: 40px;
      filter: brightness(0) invert(1);
    }
    
    .nav-link {
      color: white;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      transition: opacity 0.3s;
    }
    
    .nav-link:hover {
      opacity: 0.7;
    }
    
    /* Hero Section */
    .hero {
      position: relative;
      height: 100vh;
      background: url('assets/images/hero-drone.jpg') center/cover;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
    }
    
    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    
    .hero-content {
      position: relative;
      z-index: 1;
    }
    
    .hero h1 {
      font-size: 72px;
      font-weight: 700;
      margin-bottom: 20px;
      letter-spacing: -2px;
    }
    
    .hero p {
      font-size: 24px;
      font-weight: 300;
    }
    
    /* Main Content */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 80px 20px;
    }
    
    .section {
      margin-bottom: 80px;
      text-align: center;
    }
    
    h1 {
      font-size: 48px;
      margin-bottom: 20px;
      font-weight: 700;
    }
    
    h2 {
      font-size: 32px;
      margin-bottom: 30px;
      font-weight: 600;
    }
    
    p {
      font-size: 18px;
      line-height: 1.8;
      margin-bottom: 20px;
      color: #666;
    }
    
    /* Features Grid */
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 40px;
      margin: 60px 0;
    }
    
    .feature {
      text-align: center;
      padding: 20px;
    }
    
    .feature-icon {
      width: 100px;
      height: 100px;
      margin: 0 auto 20px;
    }
    
    .feature p {
      font-size: 16px;
    }
    
    /* Video Section */
    .video-section {
      background: #000;
      padding: 60px 0;
      margin: 80px 0;
    }
    
    .video-placeholder {
      max-width: 900px;
      margin: 0 auto;
      aspect-ratio: 16/9;
      background: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
    }
    
    /* GitHub Button */
    .github-button {
      display: inline-block;
      background: #333;
      color: white;
      padding: 15px 40px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      transition: opacity 0.3s;
      margin: 40px 0;
    }
    
    .github-button:hover {
      opacity: 0.8;
    }
    
    /* Footer */
    footer {
      background: #1a1a1a;
      color: white;
      padding: 50px 0;
      text-align: center;
      margin-top: 100px;
    }
    
    .footer-nav {
      margin-bottom: 30px;
    }
    
    .footer-nav a {
      color: white;
      text-decoration: none;
      margin: 0 20px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition: opacity 0.3s;
    }
    
    .footer-nav a:hover {
      opacity: 0.7;
    }
    
    .social-icon {
      display: inline-block;
      width: 40px;
      height: 40px;
      margin: 20px 10px;
    }
    
    .social-icon svg {
      width: 100%;
      height: 100%;
      fill: white;
      transition: opacity 0.3s;
    }
    
    .social-icon:hover svg {
      opacity: 0.7;
    }
    
    /* Cookie Banner */
    .cookie-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #222;
      color: white;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 9999;
    }
    
    .cookie-banner p {
      color: white;
      margin: 0;
      flex: 1;
    }
    
    .cookie-banner button {
      background: white;
      color: #222;
      border: none;
      padding: 10px 20px;
      cursor: pointer;
      font-weight: 600;
      margin-left: 20px;
    }
    
    .cookie-banner.hidden {
      display: none;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <a href="/" class="logo">
      <img src="assets/images/logo.png" alt="Bounder">
    </a>
    <nav>
      <a href="contact.html" class="nav-link">CONTACT</a>
    </nav>
  </header>

  <!-- Hero Section -->
  <section class="hero">
    <div class="hero-content">
      <h1>BOUNDER</h1>
      <p>Keep Drones Where They Should Be.</p>
    </div>
  </section>

  <!-- Main Content -->
  <div class="container">
    <section class="section">
      <h1>Bounder tracks drones at your event to enforce no-fly zones.</h1>
      <h2>Drones are a fantastic tool when used responsibly.</h2>
      <p>Unfortunately, accidents with drones are increasingly common, causing personal injury, threats to public safety, even power line disruptions.</p>
      <p>Bounder is your first defense against such liabilities.</p>
    </section>

    <section class="section">
      <h2>The Hardware</h2>
      <div class="features">
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="80" r="8" fill="none" stroke="#333" stroke-width="2"/>
              <line x1="50" y1="72" x2="50" y2="20" stroke="#333" stroke-width="3"/>
              <path d="M 35 15 Q 50 5, 65 15" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="2,2"/>
            </svg>
          </div>
          <p>A low-power GSM base-station centralises control</p>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect x="25" y="35" width="50" height="30" fill="none" stroke="#333" stroke-width="2" rx="3"/>
              <circle cx="35" cy="50" r="3" fill="#333"/>
              <circle cx="50" cy="50" r="3" fill="#333"/>
              <circle cx="65" cy="50" r="3" fill="#333"/>
            </svg>
          </div>
          <p>A 50gram matchbox-sized transceiver on each drone</p>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect x="35" y="25" width="30" height="50" fill="none" stroke="#333" stroke-width="2" rx="3"/>
              <path d="M 50 45 L 46 52 L 54 52 L 50 59" stroke="#333" stroke-width="2" fill="none"/>
              <text x="50" y="70" text-anchor="middle" font-size="10" fill="#333">$</text>
            </svg>
          </div>
          <p>Optionally charge for each Bounder transceiver</p>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>The Software</h2>
      <div class="features">
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="35" fill="none" stroke="#333" stroke-width="2"/>
              <line x1="25" y1="25" x2="75" y2="75" stroke="#ff0000" stroke-width="3"/>
              <line x1="75" y1="25" x2="25" y2="75" stroke="#ff0000" stroke-width="3"/>
            </svg>
          </div>
          <p>Specify which areas are no-fly zones</p>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect x="20" y="20" width="60" height="60" fill="none" stroke="#333" stroke-width="2"/>
              <circle cx="40" cy="45" r="3" fill="#ff0000"/>
              <circle cx="60" cy="55" r="3" fill="#00ff00"/>
              <path d="M 40 45 L 60 55" stroke="#333" stroke-width="1" stroke-dasharray="2,2"/>
            </svg>
          </div>
          <p>Watch drone movements in real time on your device</p>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <rect x="30" y="20" width="40" height="60" fill="none" stroke="#333" stroke-width="2" rx="5"/>
              <circle cx="55" cy="30" r="8" fill="#ff0000"/>
              <text x="55" y="35" text-anchor="middle" fill="white" font-size="12" font-weight="bold">!</text>
            </svg>
          </div>
          <p>Live notification of infractions to you, and to them</p>
        </div>
      </div>
    </section>

    <!-- Video Section -->
    <div class="video-section">
      <div class="video-placeholder">
        <p>This video is private</p>
      </div>
    </div>

    <section class="section">
      <h1>Never be at the mercy of rogue drones again!</h1>
      <h2>Bounder technology has now been released free and open source (MIT License)!</h2>
      <a href="https://github.com/NellWatson/Bounder" class="github-button" target="_blank">GITHUB</a>
    </section>
  </div>

  <!-- Footer -->
  <footer>
    <div class="footer-nav">
      <a href="terms.html">Terms & Conditions</a>
      <a href="privacy.html">Privacy & Cookies</a>
    </div>
    <a href="https://github.com/NellWatson/Bounder" target="_blank" class="social-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    </a>
  </footer>

  <!-- Cookie Banner -->
  <div class="cookie-banner" id="cookieBanner">
    <p>By using this website, you agree to our use of cookies. We use cookies to provide you with a great experience and to help our website run effectively.</p>
    <button onclick="acceptCookies()">OK</button>
  </div>

  <script>
    // Cookie banner
    function acceptCookies() {
      localStorage.setItem('cookiesAccepted', 'true');
      document.getElementById('cookieBanner').classList.add('hidden');
    }
    
    // Check if already accepted
    if (localStorage.getItem('cookiesAccepted') === 'true') {
      document.getElementById('cookieBanner').classList.add('hidden');
    }
  </script>
</body>
</html>`;
    
    // Save the homepage
    await fs.writeFile('docs/index.html', cleanHTML, 'utf-8');
    console.log('✅ Homepage created');
    
    // Create other pages with similar structure
    const pages = ['contact', 'privacy', 'terms', 'gallery-shift', 'ride-to-live-shift'];
    
    for (const pageName of pages) {
      console.log(`📄 Processing ${pageName} page...`);
      await page.goto(`https://bounder.io/${pageName}`, { 
        waitUntil: 'networkidle0',
        timeout: 60000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pageContent = await page.evaluate(() => {
        const mainContent = document.querySelector('.content-wrapper, .site-inner-wrapper, main, #content');
        return mainContent ? mainContent.innerHTML : '';
      });
      
      let pageHTML = cleanHTML.replace(
        '<div class="container">',
        `<div class="container">${pageContent}`
      );
      
      // Special handling for contact page
      if (pageName === 'contact') {
        pageHTML = pageHTML.replace(
          '<!-- Main Content -->',
          `<!-- Main Content -->
          <style>
            .contact-form {
              max-width: 600px;
              margin: 80px auto;
              padding: 0 20px;
            }
            .form-group {
              margin-bottom: 25px;
            }
            .form-group label {
              display: block;
              margin-bottom: 8px;
              font-weight: 600;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .form-group input,
            .form-group textarea {
              width: 100%;
              padding: 12px;
              border: 1px solid #ccc;
              font-size: 16px;
            }
            .form-group textarea {
              min-height: 150px;
              resize: vertical;
            }
            .form-submit {
              text-align: center;
              margin-top: 30px;
            }
            .form-submit button {
              background: #333;
              color: white;
              border: none;
              padding: 15px 40px;
              font-size: 13px;
              font-weight: 700;
              letter-spacing: 2px;
              text-transform: uppercase;
              cursor: pointer;
              transition: opacity 0.3s;
            }
            .form-submit button:hover {
              opacity: 0.8;
            }
          </style>`
        );
        
        pageHTML = pageHTML.replace(
          '<div class="container">',
          `<div class="container">
            <h1>Contact</h1>
            <form action="https://formspree.io/f/xwpkbzvr" method="POST" class="contact-form">
              <div class="form-group">
                <label for="name">Name *</label>
                <input type="text" id="name" name="name" required>
              </div>
              <div class="form-group">
                <label for="email">Email Address *</label>
                <input type="email" id="email" name="email" required>
              </div>
              <div class="form-group">
                <label for="phone">Phone</label>
                <input type="tel" id="phone" name="phone">
              </div>
              <div class="form-group">
                <label for="message">Message *</label>
                <textarea id="message" name="message" required></textarea>
              </div>
              <div class="form-submit">
                <button type="submit">SUBMIT ENQUIRY</button>
              </div>
            </form>`
        );
      }
      
      await fs.writeFile(`docs/${pageName}.html`, pageHTML, 'utf-8');
      console.log(`✅ ${pageName}.html created`);
    }
    
    // Download favicon
    try {
      await downloadFile('https://bounder.io/favicon.ico', 'docs/favicon.ico');
      console.log('✅ Favicon downloaded');
    } catch (err) {
      console.log('⚠️ Could not download favicon');
    }
    
    console.log('\n🎉 Perfect clone complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

perfectClone().catch(console.error);