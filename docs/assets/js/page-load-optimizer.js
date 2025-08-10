// Page Load Optimizer - Ensures faster local page loading
document.addEventListener('DOMContentLoaded', function() {
  // Remove loading delays and ensure instant content display
  document.body.style.visibility = 'visible';
  document.body.style.opacity = '1';
  
  // Force display of any hidden content
  const hiddenElements = document.querySelectorAll('[style*="visibility: hidden"], [style*="display: none"]');
  hiddenElements.forEach(el => {
    // Don't unhide cookie banner elements if they should be hidden
    if (!el.classList.contains('gdpr-cookie-banner') && 
        !el.classList.contains('cookie-banner-mount-point') &&
        !el.closest('.gdpr-cookie-banner')) {
      el.style.visibility = 'visible';
      el.style.display = '';
    }
  });
  
  // Prevent external script loading delays
  const externalScripts = document.querySelectorAll('script[src*="squarespace"], script[src*="typekit"]');
  externalScripts.forEach(script => {
    script.onerror = function() {
      console.log('External script failed to load:', this.src);
    };
  });
  
  // Ensure main content is visible immediately
  const mainContent = document.querySelector('#canvas, #page, .main-content, main');
  if (mainContent) {
    mainContent.style.opacity = '1';
    mainContent.style.visibility = 'visible';
  }
});

// Immediate visibility fix (runs before DOM is ready)
(function() {
  document.documentElement.style.visibility = 'visible';
  document.documentElement.classList.remove('wf-loading');
})();