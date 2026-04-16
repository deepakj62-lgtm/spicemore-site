// ===== HAMBURGER MENU =====
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
    });

    // Close menu when a direct link is clicked (not dropdown triggers)
    navLinks.querySelectorAll('a:not(.dropdown-trigger)').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
      });
    });
  }

  // ===== MOBILE DROPDOWN TOGGLE =====
  const dropdownTrigger = document.querySelector('.dropdown-trigger');
  const navDropdown = document.querySelector('.nav-dropdown');
  if (dropdownTrigger && navDropdown) {
    dropdownTrigger.addEventListener('click', function(e) {
      // On mobile, toggle dropdown instead of navigating
      if (window.innerWidth <= 768) {
        e.preventDefault();
        navDropdown.classList.toggle('open');
      }
    });
  }

  // ===== SLIDESHOW =====
  const slides = document.querySelectorAll('.slide');
  const counter = document.querySelector('.slide-counter');
  let current = 0;

  function showSlide(n) {
    slides.forEach(s => s.classList.remove('active'));
    current = (n + slides.length) % slides.length;
    slides[current].classList.add('active');
    if (counter) counter.textContent = `${current + 1}/${slides.length}`;
  }

  const prevBtn = document.querySelector('.slide-prev');
  const nextBtn = document.querySelector('.slide-next');

  if (prevBtn) prevBtn.addEventListener('click', () => showSlide(current - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => showSlide(current + 1));

  // Auto-advance slideshow every 4 seconds
  if (slides.length > 0) {
    setInterval(() => showSlide(current + 1), 4000);
  }

  // ===== CONTACT FORMS =====
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const success = form.querySelector('.form-success');
      if (success) {
        success.classList.add('show');
        form.reset();
        setTimeout(() => success.classList.remove('show'), 4000);
      }
    });
  });

  // ===== ACTIVE NAV LINK =====
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
});
