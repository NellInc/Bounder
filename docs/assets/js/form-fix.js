/**
 * Form Fix
 * Ensures the contact form displays correctly with all fields including privacy checkbox
 */

(function() {
    'use strict';
    
    function ensureFormIntegrity() {
        const form = document.querySelector('form[action*="formspree"]');
        if (!form) return;
        
        // Check if privacy checkbox exists
        let privacyField = document.getElementById('privacy-consent');
        
        // If privacy field was removed by other scripts, re-add it
        if (!privacyField && form.querySelector('.field-list')) {
            const fieldList = form.querySelector('.field-list');
            const existingPrivacy = fieldList.querySelector('#privacy-consent');
            
            if (!existingPrivacy) {
                // Create privacy consent field
                const privacyHTML = `
                    <div class="form-item field checkbox required" id="privacy-consent" data-dynamic-strings="" style="margin-top: 20px;">
                        <div style="display: flex; align-items: flex-start;">
                            <input type="checkbox" id="privacy-consent-field" name="privacy-consent" aria-required="true" required style="margin-right: 10px; margin-top: 3px;">
                            <label for="privacy-consent-field" class="title YB_rseKyzcQ64VtF" style="font-weight: normal; margin: 0; cursor: pointer;">
                                <div class="KBeHkQJXlg4N1Ujt">
                                    <div class="SP08ZLkhAnk2Rqaf" style="font-size: 14px; line-height: 1.5;">
                                        I agree to the processing of my personal data in accordance with the <a href="privacy.html" target="_blank" style="color: inherit; text-decoration: underline;">privacy policy</a> and consent to being contacted regarding my enquiry.
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>`;
                
                // Insert before the honeypot field or at the end of field list
                const honeypot = fieldList.querySelector('input[name="_gotcha"]');
                if (honeypot && honeypot.parentElement) {
                    honeypot.parentElement.insertAdjacentHTML('beforebegin', privacyHTML);
                } else {
                    fieldList.insertAdjacentHTML('beforeend', privacyHTML);
                }
            }
        }
        
        // Ensure all fields are visible
        const allFields = form.querySelectorAll('.form-item');
        allFields.forEach(field => {
            if (field.style.display === 'none' && !field.querySelector('[name="_gotcha"]')) {
                field.style.display = '';
            }
        });
        
        // Make sure the form maintains proper styling
        if (form && !form.classList.contains('form-fixed')) {
            form.classList.add('form-fixed');
            
            // Add custom styles to ensure proper display
            const style = document.createElement('style');
            style.textContent = `
                .form-fixed .field-list {
                    display: block !important;
                }
                .form-fixed .form-item {
                    margin-bottom: 20px;
                }
                .form-fixed #privacy-consent {
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                }
                .form-fixed input[type="text"],
                .form-fixed input[type="email"],
                .form-fixed input[type="tel"],
                .form-fixed textarea {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-size: 16px;
                }
                .form-fixed button[type="submit"] {
                    background-color: #000;
                    color: #fff;
                    padding: 12px 24px;
                    border: none;
                    border-radius: 4px;
                    font-size: 16px;
                    cursor: pointer;
                    transition: background-color 0.3s;
                }
                .form-fixed button[type="submit"]:hover {
                    background-color: #333;
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Run immediately
    ensureFormIntegrity();
    
    // Run after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureFormIntegrity);
    } else {
        // DOM is already loaded
        ensureFormIntegrity();
    }
    
    // Run when window loads completely
    window.addEventListener('load', ensureFormIntegrity);
    
    // Run after delays to catch any dynamic changes
    setTimeout(ensureFormIntegrity, 100);
    setTimeout(ensureFormIntegrity, 500);
    setTimeout(ensureFormIntegrity, 1000);
    setTimeout(ensureFormIntegrity, 2000);
    setTimeout(ensureFormIntegrity, 3000);
    
    // Monitor for changes
    const observer = new MutationObserver(function(mutations) {
        ensureFormIntegrity();
    });
    
    // Start observing
    const targetNode = document.querySelector('.form-wrapper') || document.body;
    observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true
    });
})();