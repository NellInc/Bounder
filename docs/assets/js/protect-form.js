/**
 * Protect the contact form from being replaced by Squarespace scripts
 * This script must run BEFORE site-bundle.js
 */

(function() {
    'use strict';
    
    // Store the original form HTML immediately
    const originalFormHTML = document.querySelector('.form-wrapper')?.innerHTML;
    
    if (!originalFormHTML) {
        console.error('Could not find form wrapper to protect');
        return;
    }
    
    // Method 1: Protect the form wrapper from modifications
    const formWrapper = document.querySelector('.form-wrapper');
    if (formWrapper) {
        // Make the form wrapper and its children immutable
        const protectElement = (element) => {
            // Override React's ability to modify this element
            Object.defineProperty(element, 'innerHTML', {
                get() { return originalFormHTML; },
                set() { 
                    console.warn('Blocked attempt to modify form HTML');
                    return false; 
                }
            });
            
            // Prevent removal
            const originalRemove = element.remove;
            element.remove = function() {
                console.warn('Blocked attempt to remove form');
                return false;
            };
            
            // Prevent replaceWith
            const originalReplaceWith = element.replaceWith;
            element.replaceWith = function() {
                console.warn('Blocked attempt to replace form');
                return false;
            };
        };
        
        protectElement(formWrapper);
    }
    
    // Method 2: Restore form if it gets replaced
    const restoreForm = () => {
        const wrapper = document.querySelector('.form-wrapper');
        if (wrapper && !wrapper.querySelector('form[action*="formspree"]')) {
            console.log('Restoring original form...');
            wrapper.innerHTML = originalFormHTML;
        }
    };
    
    // Monitor for changes and restore if needed
    const observer = new MutationObserver(() => {
        restoreForm();
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Method 3: Override React mounting points
    window.addEventListener('DOMContentLoaded', () => {
        // Prevent React from mounting on our form
        const formWrapper = document.querySelector('.form-wrapper');
        if (formWrapper) {
            // Add a flag that might prevent React from touching it
            formWrapper.setAttribute('data-react-skip', 'true');
            formWrapper.classList.add('no-react');
            
            // Some React apps check for this
            Object.defineProperty(formWrapper, '_reactRootContainer', {
                get() { return undefined; },
                set() { return false; }
            });
        }
    });
    
    // Method 4: Periodically check and restore
    let checkCount = 0;
    const checkInterval = setInterval(() => {
        restoreForm();
        checkCount++;
        if (checkCount > 20) { // Stop after 10 seconds
            clearInterval(checkInterval);
        }
    }, 500);
    
    console.log('Form protection activated');
})();