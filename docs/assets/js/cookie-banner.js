// Cookie banner dismiss functionality
document.addEventListener('DOMContentLoaded', function() {
  // Function to set cookie with proper attributes
  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = '; expires=' + date.toUTCString();
    // Set cookie with path=/ to work across all pages and SameSite=Lax for security
    document.cookie = name + '=' + value + expires + '; path=/; SameSite=Lax';
    
    // Also use localStorage as fallback for local file:// contexts
    try {
      localStorage.setItem(name, value);
    } catch(e) {
      // localStorage might not be available
    }
  }
  
  // Function to get cookie value
  function getCookie(name) {
    // First try localStorage (works better for local file:// contexts)
    try {
      const localValue = localStorage.getItem(name);
      if (localValue) return localValue;
    } catch(e) {
      // localStorage might not be available
    }
    
    // Fallback to cookies
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      let c = cookies[i].trim();
      if (c.indexOf(nameEQ) === 0) {
        return c.substring(nameEQ.length);
      }
    }
    return null;
  }
  
  // Get elements
  const acceptButton = document.querySelector('.sqs-cookie-banner-v2-accept');
  const cookieBanner = document.querySelector('.gdpr-cookie-banner');
  const cookieBannerMount = document.querySelector('.cookie-banner-mount-point');
  
  // Check if cookie banner was previously dismissed
  if (getCookie('cookie_banner_dismissed') === 'true') {
    if (cookieBanner) {
      cookieBanner.style.display = 'none';
      cookieBanner.remove(); // Remove from DOM completely
    }
    if (cookieBannerMount) {
      cookieBannerMount.style.display = 'none';
      cookieBannerMount.remove(); // Remove from DOM completely
    }
  } else {
    // Only add event listener if banner is visible
    if (acceptButton && cookieBanner) {
      acceptButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Hide the cookie banner
        cookieBanner.style.display = 'none';
        if (cookieBannerMount) {
          cookieBannerMount.style.display = 'none';
        }
        
        // Set cookie to remember the user's choice for 1 year
        setCookie('cookie_banner_dismissed', 'true', 365);
        
        // Remove elements from DOM after hiding
        setTimeout(function() {
          if (cookieBanner) cookieBanner.remove();
          if (cookieBannerMount) cookieBannerMount.remove();
        }, 300);
      });
    }
  }
});