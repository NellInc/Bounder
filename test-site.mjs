#!/usr/bin/env node

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// Serve static files from docs directory
app.use(express.static(path.join(__dirname, 'docs')));

// Handle all routes by serving the appropriate HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'contact.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'terms.html'));
});

app.get('/gallery-shift', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'gallery-shift.html'));
});

app.get('/ride-to-live-shift', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'ride-to-live-shift.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('📝 Pages available:');
  console.log(`   - Homepage: http://localhost:${PORT}/`);
  console.log(`   - Contact: http://localhost:${PORT}/contact`);
  console.log(`   - Privacy: http://localhost:${PORT}/privacy`);
  console.log(`   - Terms: http://localhost:${PORT}/terms`);
  console.log(`   - Gallery Shift: http://localhost:${PORT}/gallery-shift`);
  console.log(`   - Ride to Live Shift: http://localhost:${PORT}/ride-to-live-shift`);
  console.log('\nPress Ctrl+C to stop the server');
  
  // Open the homepage in default browser
  open(`http://localhost:${PORT}`);
});