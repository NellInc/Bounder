// External Links Handler - Opens all external links in new tabs
document.addEventListener('DOMContentLoaded', function() {
  // Function to check if a URL is external
  function isExternalLink(url) {
    if (!url) return false;
    
    // Parse the URL
    try {
      const link = new URL(url, window.location.href);
      const currentHost = window.location.hostname;
      
      // Check if the link is external (different host)
      // Exclude local file paths and same domain
      return link.hostname && 
             link.hostname !== currentHost && 
             link.hostname !== 'www.bounder.io' &&
             link.hostname !== 'bounder.io' &&
             !link.href.startsWith('file://') &&
             !link.href.startsWith('#') &&
             !link.href.startsWith('mailto:') &&
             !link.href.startsWith('tel:');
    } catch (e) {
      return false;
    }
  }
  
  // Process all links on the page
  function processLinks() {
    const links = document.querySelectorAll('a[href]');
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      
      // Skip if already has target attribute set
      if (link.hasAttribute('target')) return;
      
      // Check if it's an external link
      if (isExternalLink(href)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        
        // Optional: Add a visual indicator for external links
        link.classList.add('external-link');
      }
    });
  }
  
  // Process links on page load
  processLinks();
  
  // Also process any dynamically added links
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) { // Element node
            if (node.tagName === 'A') {
              const href = node.getAttribute('href');
              if (!node.hasAttribute('target') && isExternalLink(href)) {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
                node.classList.add('external-link');
              }
            }
            // Also check for links within the added node
            const links = node.querySelectorAll && node.querySelectorAll('a[href]');
            if (links) {
              links.forEach(link => {
                const href = link.getAttribute('href');
                if (!link.hasAttribute('target') && isExternalLink(href)) {
                  link.setAttribute('target', '_blank');
                  link.setAttribute('rel', 'noopener noreferrer');
                  link.classList.add('external-link');
                }
              });
            }
          }
        });
      }
    });
  });
  
  // Start observing the document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
});