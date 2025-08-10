/**
 * Scroll Arrow Functionality
 * Implements smooth scroll behavior for the "SCROLL DOWN" arrow
 */

(function() {
    'use strict';
    
    function initScrollArrow() {
        // Find the scroll arrow element
        const scrollArrow = document.querySelector('.scroll-arrow');
        
        if (!scrollArrow) {
            return;
        }
        
        // Find the target content section to scroll to
        const targetContent = document.querySelector('.content.has-main-image.has-content');
        
        if (!targetContent) {
            return;
        }
        
        // Make the scroll arrow clickable
        scrollArrow.style.cursor = 'pointer';
        
        // Add hover effect
        scrollArrow.addEventListener('mouseenter', function() {
            this.style.opacity = '0.7';
            this.style.transform = 'translateY(2px)';
            this.style.transition = 'all 0.3s ease';
        });
        
        scrollArrow.addEventListener('mouseleave', function() {
            this.style.opacity = '1';
            this.style.transform = 'translateY(0)';
        });
        
        // Add click handler for smooth scroll
        scrollArrow.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Calculate the target position
            const targetPosition = targetContent.getBoundingClientRect().top + window.pageYOffset;
            const headerHeight = document.getElementById('header') ? document.getElementById('header').offsetHeight : 0;
            const scrollToPosition = targetPosition - headerHeight;
            
            // Smooth scroll to the target
            window.scrollTo({
                top: scrollToPosition,
                behavior: 'smooth'
            });
        });
        
        // Also add keyboard support (Enter/Space)
        scrollArrow.setAttribute('tabindex', '0');
        scrollArrow.setAttribute('role', 'button');
        scrollArrow.setAttribute('aria-label', 'Scroll down to content');
        
        scrollArrow.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
        
        // Add a subtle animation to draw attention
        const style = document.createElement('style');
        style.textContent = `
            @keyframes gentle-bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(5px); }
            }
            
            .scroll-arrow {
                animation: gentle-bounce 2s ease-in-out infinite;
                transition: all 0.3s ease;
            }
            
            .scroll-arrow:hover {
                animation-play-state: paused;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initScrollArrow);
    } else {
        initScrollArrow();
    }
    
    // Also initialize after a delay to catch any dynamic content
    setTimeout(initScrollArrow, 1000);
})();