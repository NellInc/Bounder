/**
 * Parallax Footer Fix
 * Prevents parallax background from showing below the footer
 * Only affects the overflow area without breaking the parallax effect
 */

(function() {
    'use strict';
    
    function fixParallaxOverflow() {
        const footer = document.getElementById('footer');
        const parallaxContainer = document.getElementById('parallax-images');
        
        if (!footer || !parallaxContainer) {
            return;
        }
        
        // Create a mask element that will hide content below the footer
        let maskElement = document.getElementById('parallax-mask');
        if (!maskElement) {
            maskElement = document.createElement('div');
            maskElement.id = 'parallax-mask';
            maskElement.style.cssText = `
                position: fixed;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                z-index: 1;
                background: #171717;
            `;
            document.body.appendChild(maskElement);
        }
        
        function updateMask() {
            const footerRect = footer.getBoundingClientRect();
            const windowHeight = window.innerHeight;
            
            // Calculate how much of the footer is visible
            if (footerRect.top < windowHeight) {
                // Footer is in view - create mask from footer top to bottom of viewport
                const maskHeight = windowHeight - footerRect.top;
                maskElement.style.height = maskHeight + 'px';
                maskElement.style.display = 'block';
            } else {
                // Footer is not in view - hide mask
                maskElement.style.display = 'none';
            }
        }
        
        // Update on scroll and resize
        let ticking = false;
        function requestUpdate() {
            if (!ticking) {
                window.requestAnimationFrame(function() {
                    updateMask();
                    ticking = false;
                });
                ticking = true;
            }
        }
        
        window.addEventListener('scroll', requestUpdate, { passive: true });
        window.addEventListener('resize', requestUpdate, { passive: true });
        
        // Initial update
        updateMask();
        
        // Also add a CSS-based solution as backup
        const style = document.createElement('style');
        style.textContent = `
            #footer {
                position: relative;
                z-index: 2;
                background-color: #171717 !important;
            }
            
            /* Ensure footer wrapper has solid background */
            #footer .footer-wrapper {
                background-color: #171717 !important;
                position: relative;
                z-index: 2;
            }
            
            /* Add extra coverage below footer */
            #footer::after {
                content: '';
                position: absolute;
                left: 0;
                right: 0;
                top: 100%;
                height: 100vh;
                background-color: #171717;
                z-index: 2;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fixParallaxOverflow);
    } else {
        fixParallaxOverflow();
    }
    
    // Also run after a delay to catch any dynamic changes
    setTimeout(fixParallaxOverflow, 1000);
})();