// Mobile contact link functionality - positioned at bottom of screen
document.addEventListener('DOMContentLoaded', function() {
    // Only run on mobile
    if (window.innerWidth <= 768) {
        // Create mobile nav bar
        const navBar = document.createElement('div');
        navBar.className = 'mobile-nav-bar';
        
        // Create contact link
        const contactLink = document.createElement('a');
        contactLink.href = 'contact.html';
        contactLink.textContent = 'Contact';
        
        // Append link to nav bar
        navBar.appendChild(contactLink);
        
        // Append nav bar to body
        document.body.appendChild(navBar);
    }
});