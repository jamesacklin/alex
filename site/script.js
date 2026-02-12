/**
 * Alex Landing Page - JavaScript
 * Handles scroll animations and parallax effects
 */

(function() {
  'use strict';

  // Parallax effect for hero background
  function initParallax() {
    const heroBackground = document.querySelector('.hero-background');
    if (!heroBackground) return;

    let ticking = false;

    function updateParallax() {
      const scrollY = window.scrollY;
      const offset = scrollY * 0.5;
      heroBackground.style.transform = `translateY(${offset}px)`;
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (!ticking) {
        window.requestAnimationFrame(updateParallax);
        ticking = true;
      }
    }, { passive: true });
  }

  // Fade-in animations on scroll
  function initScrollAnimations() {
    const fadeElements = document.querySelectorAll('.fade-in-up');
    if (fadeElements.length === 0) return;

    const observerOptions = {
      threshold: 0.1,
      rootMargin: '-50px'
    };

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, observerOptions);

    fadeElements.forEach(function(element) {
      observer.observe(element);
    });
  }

  // Smooth scroll for anchor links
  function initSmoothScroll() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(function(link) {
      link.addEventListener('click', function(e) {
        const href = this.getAttribute('href');

        // Don't prevent default for empty hash or just #
        if (!href || href === '#') return;

        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }

  // Initialize everything when DOM is ready
  function init() {
    initParallax();
    initScrollAnimations();
    initSmoothScroll();
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
