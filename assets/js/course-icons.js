/* Add a keyword rule or a course-code override to extend the subject library.
   Icons come from the bundled Lucide collection, so no external requests are needed. */
(function () {
  const categories = [
    { id: 'computing', label: 'Computing', icon: 'terminal', tone: 'purple', keywords: /programming|comput(?:er|ing)|software|information (?:systems|technology)|\b(?:CC|CS|IT|HCI)\s*\d|algorithm|database|network|web development/i },
    { id: 'business', label: 'Business', icon: 'briefcase-business', tone: 'orange', keywords: /business|account(?:ing|ancy)|finance|marketing|management|entrepreneur|economics|\b(?:BA|BSA|ENT|ACC)\s*\d/i },
    { id: 'math', label: 'Mathematics', icon: 'chart-no-axes-combined', tone: 'teal', keywords: /math|algebra|calculus|statistics|geometry/i },
    { id: 'science', label: 'Science', icon: 'flask-conical', tone: 'teal', keywords: /biology|chemistry|physics|ecosystem|environment|engineering/i },
    { id: 'creative', label: 'Arts & design', icon: 'palette', tone: 'orange', keywords: /art appreciation|design|drawing|multimedia|architecture/i },
    { id: 'wellness', label: 'Wellness', icon: 'activity', tone: 'orange', keywords: /physical|fitness|wellness|sports|\bPE\s*\d/i },
    { id: 'general', label: 'General studies', icon: 'book-open', tone: 'purple', keywords: null }
  ];
  const overrides = {}; // Example: 'CUSTOM101': 'business'
  function resolve(code = '', title = '') {
    const key = String(code).trim().toUpperCase();
    return categories.find(category => category.id === overrides[key]) ||
      categories.find(category => category.keywords?.test(`${code} ${title}`)) || categories.at(-1);
  }
  window.QCUCourseIcons = Object.freeze({ categories, resolve });
})();
