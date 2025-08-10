#!/usr/bin/env node

import fs from 'fs/promises';
import { JSDOM } from 'jsdom';

async function setupContactForm() {
  console.log('📧 Setting up contact form for GitHub Pages...');
  
  try {
    // Read the contact.html file
    const html = await fs.readFile('docs/contact.html', 'utf-8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Find the form section
    const formBlock = document.querySelector('.sqs-block-form, .form-wrapper, form');
    
    if (formBlock) {
      // Create a clean contact form that works with Formspree
      const newForm = `
        <div class="sqs-block-content">
          <div class="form-wrapper">
            <div class="form-inner-wrapper">
              <form action="https://formspree.io/f/xwpkbzvr" method="POST" class="contact-form">
                <div class="field-list clear">
                  
                  <fieldset class="form-item fields name">
                    <legend>Name</legend>
                    <div class="row">
                      <div class="col">
                        <label class="caption">
                          <input class="field-element field-control" type="text" name="fname" placeholder="First Name" required>
                          <span class="caption-text">First Name</span>
                        </label>
                      </div>
                      <div class="col">
                        <label class="caption">
                          <input class="field-element field-control" type="text" name="lname" placeholder="Last Name" required>
                          <span class="caption-text">Last Name</span>
                        </label>
                      </div>
                    </div>
                  </fieldset>
                  
                  <div class="form-item field email required">
                    <label class="title" for="email">
                      Email Address <span class="required">*</span>
                    </label>
                    <input class="field-element" type="email" id="email" name="email" required>
                  </div>
                  
                  <div class="form-item field text">
                    <label class="title" for="phone">Phone</label>
                    <input class="field-element" type="tel" id="phone" name="phone">
                  </div>
                  
                  <div class="form-item field textarea required">
                    <label class="title" for="message">
                      Message <span class="required">*</span>
                    </label>
                    <textarea class="field-element" id="message" name="message" rows="6" required></textarea>
                  </div>
                  
                </div>
                
                <div class="form-button-wrapper form-button-wrapper--align-center">
                  <button type="submit" class="button sqs-system-button sqs-editable-button sqs-button-element--primary">
                    SUBMIT ENQUIRY
                  </button>
                </div>
                
              </form>
            </div>
          </div>
        </div>
      `;
      
      // Find the form's parent block
      let formParent = formBlock.closest('.sqs-block-form');
      if (!formParent) {
        formParent = formBlock.closest('.sqs-block');
      }
      if (!formParent) {
        formParent = formBlock.parentElement;
      }
      
      if (formParent) {
        formParent.innerHTML = newForm;
      }
    }
    
    // Add custom styles for the form
    const formStyles = document.createElement('style');
    formStyles.textContent = `
      /* Contact Form Styles */
      .contact-form {
        max-width: 600px;
        margin: 0 auto;
      }
      
      .form-item {
        margin-bottom: 2rem;
      }
      
      .form-item label.title {
        display: block;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        margin-bottom: 0.5rem;
        color: #333;
      }
      
      .form-item input,
      .form-item textarea {
        width: 100%;
        padding: 12px 15px;
        border: 1px solid #ccc;
        background: white;
        font-size: 14px;
        line-height: 1.5;
        transition: border-color 0.3s ease;
      }
      
      .form-item input:focus,
      .form-item textarea:focus {
        outline: none;
        border-color: #333;
      }
      
      .fields.name .row {
        display: flex;
        gap: 1rem;
      }
      
      .fields.name .col {
        flex: 1;
      }
      
      .fields.name input {
        width: 100%;
        padding: 12px 15px;
        border: 1px solid #ccc;
        background: white;
        font-size: 14px;
      }
      
      .fields.name legend {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        margin-bottom: 0.5rem;
        color: #333;
      }
      
      .caption-text {
        display: none;
      }
      
      .form-button-wrapper {
        text-align: center;
        margin-top: 2rem;
      }
      
      .form-button-wrapper button {
        background: #333;
        color: white;
        border: none;
        padding: 15px 40px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        cursor: pointer;
        transition: opacity 0.3s ease;
      }
      
      .form-button-wrapper button:hover {
        opacity: 0.8;
      }
      
      .required {
        color: #e74c3c;
      }
      
      @media (max-width: 768px) {
        .fields.name .row {
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(formStyles);
    
    // Save the updated HTML
    const updatedHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    await fs.writeFile('docs/contact.html', updatedHtml, 'utf-8');
    
    console.log('✅ Contact form updated successfully!');
    console.log('\n📝 Important: The form is configured to use Formspree.');
    console.log('   Make sure the form ID (xwpkbzvr) is correct or update it with your own.');
    
  } catch (error) {
    console.error('❌ Error setting up contact form:', error);
  }
}

setupContactForm().catch(console.error);