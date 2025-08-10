/**
 * Local Form Override
 * Ensures the form displays correctly when viewing locally via file:// protocol
 */

(function() {
    'use strict';
    
    // Check if we're viewing locally
    const isLocal = window.location.protocol === 'file:';
    
    if (!isLocal) {
        return; // Only run for local file viewing
    }
    
    console.log('Local form override active');
    
    function forceShowForm() {
        // Find any form on the page
        const forms = document.querySelectorAll('form');
        
        forms.forEach(form => {
            form.style.display = 'block !important';
            form.style.visibility = 'visible !important';
            form.style.opacity = '1 !important';
        });
        
        // Show all form fields
        const formItems = document.querySelectorAll('.form-item, .field-list, .form-wrapper');
        formItems.forEach(item => {
            item.style.display = '';
            item.style.visibility = 'visible';
            item.style.opacity = '1';
        });
        
        // Specifically ensure privacy checkbox is visible
        const privacyField = document.querySelector('#privacy-consent');
        if (privacyField) {
            privacyField.style.display = 'block';
            privacyField.style.visibility = 'visible';
            privacyField.style.opacity = '1';
        }
        
        // Override any conflicting styles
        if (!document.getElementById('local-form-styles')) {
            const style = document.createElement('style');
            style.id = 'local-form-styles';
            style.textContent = `
                .form-wrapper,
                .form-wrapper * {
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                }
                
                .form-wrapper form {
                    max-width: 600px;
                    margin: 0 auto;
                }
                
                .form-wrapper .field-list > div {
                    margin-bottom: 20px !important;
                }
                
                .form-wrapper input[type="text"],
                .form-wrapper input[type="email"],
                .form-wrapper input[type="tel"],
                .form-wrapper textarea {
                    width: 100% !important;
                    padding: 10px !important;
                    border: 1px solid #ccc !important;
                    border-radius: 4px !important;
                    font-size: 16px !important;
                    display: block !important;
                }
                
                .form-wrapper textarea {
                    min-height: 120px !important;
                    resize: vertical !important;
                }
                
                .form-wrapper label {
                    display: block !important;
                    margin-bottom: 5px !important;
                    font-weight: 600 !important;
                }
                
                .form-wrapper button[type="submit"] {
                    background-color: #000 !important;
                    color: #fff !important;
                    padding: 12px 24px !important;
                    border: none !important;
                    border-radius: 4px !important;
                    font-size: 16px !important;
                    cursor: pointer !important;
                    display: inline-block !important;
                }
                
                .form-wrapper button[type="submit"]:hover {
                    background-color: #333 !important;
                }
                
                #privacy-consent {
                    display: block !important;
                    margin: 20px 0 !important;
                }
                
                #privacy-consent > div {
                    display: flex !important;
                    align-items: flex-start !important;
                }
                
                #privacy-consent input[type="checkbox"] {
                    width: auto !important;
                    margin-right: 10px !important;
                    margin-top: 3px !important;
                }
                
                #privacy-consent label {
                    font-weight: normal !important;
                    cursor: pointer !important;
                    flex: 1 !important;
                }
                
                /* Hide honeypot */
                input[name="_gotcha"] {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Aggressive execution strategy for local viewing
    forceShowForm();
    
    // Run multiple times to override any scripts
    for (let i = 0; i < 10; i++) {
        setTimeout(forceShowForm, i * 200);
    }
    
    // Also run on various events
    document.addEventListener('DOMContentLoaded', forceShowForm);
    window.addEventListener('load', forceShowForm);
    
    // Monitor and fix continuously
    setInterval(forceShowForm, 1000);
})();