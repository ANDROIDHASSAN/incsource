// Realistic mock records returned when APIFY_TOKEN is absent, so the entire
// pipeline (normalize → dedupe → score → store → UI) works with zero setup.
// Shapes loosely mirror what real LinkedIn / Naukri actors emit.

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export const mockLinkedin = (query = '') => {
  const all = [
    {
      profileUrl: 'https://linkedin.com/in/aarav-mehta',
      fullName: 'Aarav Mehta',
      headline: '#OpenToWork | Senior React Developer | Immediate Joiner',
      locationName: 'Bengaluru, Karnataka, India',
      jobTitle: 'Senior Frontend Engineer',
      companyName: 'Freshworks',
      skills: ['React', 'TypeScript', 'Node.js', 'GraphQL'],
      experienceYears: 6,
      openToWork: true,
      lastActivity: daysAgo(2),
    },
    {
      profileUrl: 'https://linkedin.com/in/priya-nair',
      fullName: 'Priya Nair',
      headline: 'Full Stack Developer (MERN) — actively looking for new roles',
      locationName: 'Pune, Maharashtra, India',
      jobTitle: 'Software Engineer',
      companyName: 'Zoho',
      skills: ['MongoDB', 'Express', 'React', 'Node.js'],
      experienceYears: 3,
      openToWork: true,
      lastActivity: daysAgo(5),
    },
    {
      profileUrl: 'https://linkedin.com/in/rahul-verma',
      fullName: 'Rahul Verma',
      headline: 'Backend Engineer | Java, Spring Boot | 9 years',
      locationName: 'Hyderabad, Telangana, India',
      jobTitle: 'Backend Developer',
      companyName: 'PhonePe',
      skills: ['Java', 'Spring Boot', 'Kafka', 'AWS'],
      experienceYears: 9,
      openToWork: false,
      lastActivity: daysAgo(40),
    },
    {
      profileUrl: 'https://linkedin.com/in/sneha-iyer',
      fullName: 'Sneha Iyer',
      headline: 'Data Scientist | Open to work | Available immediately',
      locationName: 'Chennai, Tamil Nadu, India',
      jobTitle: 'Data Scientist',
      companyName: 'Mu Sigma',
      skills: ['Python', 'ML', 'TensorFlow', 'SQL'],
      experienceYears: 4,
      openToWork: true,
      lastActivity: daysAgo(1),
    },
    {
      profileUrl: 'https://linkedin.com/in/isha-bansal',
      fullName: 'Isha Bansal',
      headline: 'Frontend Engineer (React) | Fresher | Open to work',
      locationName: 'Jaipur, Rajasthan, India',
      jobTitle: 'Frontend Engineer',
      companyName: 'GeeksforGeeks',
      skills: ['React', 'JavaScript', 'CSS', 'Redux'],
      experienceYears: 1,
      openToWork: true,
      lastActivity: daysAgo(3),
    },
    {
      profileUrl: 'https://linkedin.com/in/kabir-khanna',
      fullName: 'Kabir Khanna',
      headline: 'Principal Engineer | Distributed Systems | 14 years | #OpenToWork',
      locationName: 'Gurugram, Haryana, India',
      jobTitle: 'Principal Engineer',
      companyName: 'Flipkart',
      skills: ['Go', 'Kubernetes', 'Microservices', 'AWS', 'System Design'],
      experienceYears: 14,
      openToWork: true,
      lastActivity: daysAgo(6),
    },
  ];
  return filterByQuery(all, query, ['headline', 'jobTitle', 'companyName']);
};

function filterByQuery(items, query, fields) {
  if (!query) return items;
  const q = query.toLowerCase();
  const skillText = (it) => {
    const s = it.skills || it.keySkills || [];
    return JSON.stringify(s).toLowerCase(); // robust to string[]/object[]/nested shapes
  };
  const hit = items.filter(
    (it) => fields.some((f) => String(it[f] || '').toLowerCase().includes(q)) || skillText(it).includes(q)
  );
  return hit.length ? hit : items; // never return empty in demo mode
}

// harvestapi/linkedin-profile-search output shape (top-level openToWork, currentPosition[], skills[])
export const mockHarvest = (query = '') => {
  const all = [
    {
      publicIdentifier: 'neha-kapoor',
      firstName: 'Neha',
      lastName: 'Kapoor',
      headline: 'Senior Product Designer | Open to new opportunities',
      linkedinUrl: 'https://linkedin.com/in/neha-kapoor',
      openToWork: true,
      hiring: false,
      location: { linkedinText: 'Gurugram, Haryana, India' },
      currentPosition: [{ position: 'Product Designer', companyName: 'Paytm' }],
      skills: [{ name: 'Figma' }, { name: 'UX Research' }, { name: 'Design Systems' }],
      experienceYears: 7,
      about: 'Actively exploring senior design roles. 7 years of experience.',
    },
    {
      publicIdentifier: 'arjun-rao',
      firstName: 'Arjun',
      lastName: 'Rao',
      headline: 'Engineering Manager | React, Node | #OpenToWork',
      linkedinUrl: 'https://linkedin.com/in/arjun-rao',
      openToWork: true,
      hiring: false,
      location: { linkedinText: 'Bengaluru, Karnataka, India' },
      currentPosition: [{ position: 'Engineering Manager', companyName: 'Swiggy' }],
      skills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'Leadership' }],
      experienceYears: 11,
    },
    {
      publicIdentifier: 'divya-sharma',
      firstName: 'Divya',
      lastName: 'Sharma',
      headline: 'Marketing Lead at Nykaa',
      linkedinUrl: 'https://linkedin.com/in/divya-sharma',
      openToWork: false,
      hiring: true,
      location: { linkedinText: 'Mumbai, Maharashtra, India' },
      currentPosition: [{ position: 'Marketing Lead', companyName: 'Nykaa' }],
      skills: [{ name: 'Growth' }, { name: 'SEO' }],
      experienceYears: 8,
    },
  ];
  return filterByQuery(all, query, ['headline']);
};

// lexis-solutions/resume-indeed-com-scraper output shape
export const mockIndeed = (query = '') => {
  const all = [
    {
      matchId: 'IND-RES-1',
      name: 'Rohit Malhotra',
      currentTitle: 'Full Stack Developer',
      currentCompany: 'Accenture',
      location: 'Pune, Maharashtra, India',
      skills: ['React', 'Node.js', 'MongoDB', 'Docker'],
      experiences: [{ title: 'Full Stack Developer', company: 'Accenture', years: '3 yrs' }],
      isFreeToContact: true,
      sourceUrl: 'https://resumes.indeed.com/resume/IND-RES-1',
      highlights: ['Open to relocation', 'Available in 30 days'],
    },
    {
      matchId: 'IND-RES-2',
      name: 'Fatima Sheikh',
      currentTitle: 'Data Analyst',
      currentCompany: 'Genpact',
      location: 'Hyderabad, Telangana, India',
      skills: ['SQL', 'Python', 'Power BI', 'Excel'],
      experiences: [{ title: 'Data Analyst', company: 'Genpact', years: '2 yrs' }],
      isFreeToContact: false,
      sourceUrl: 'https://resumes.indeed.com/resume/IND-RES-2',
      highlights: ['Immediate joiner'],
    },
  ];
  return filterByQuery(all, query, ['currentTitle', 'currentCompany', 'name']);
};

// memo23/naukri-scraper output shape (simplified job posting)
export const mockNaukriJobs = (query = '') => {
  const all = [
    {
      jobId: 'NJ-5001',
      title: 'Senior MERN Developer',
      companyDetail: { name: 'HCLTech', address: 'Noida, India' },
      Location: 'Noida, India',
      keySkills: { preferred: [{ label: 'React' }, { label: 'Node.js' }], other: [{ label: 'MongoDB' }] },
      Contact: { Email: 'careers@hcltech.example' },
      url: 'https://naukri.com/job/NJ-5001',
      shortDescription: 'Hiring senior MERN developers, immediate openings.',
      basicInfo: { experienceText: '5-8 Yrs' },
    },
    {
      jobId: 'NJ-5002',
      title: 'DevOps Engineer',
      companyDetail: { name: 'Tech Mahindra', address: 'Pune, India' },
      Location: 'Pune, India',
      keySkills: { preferred: [{ label: 'AWS' }, { label: 'Kubernetes' }], other: [] },
      Contact: { Email: 'talent@techm.example' },
      url: 'https://naukri.com/job/NJ-5002',
      shortDescription: 'DevOps role, CI/CD and cloud.',
      basicInfo: { experienceText: '4-7 Yrs' },
    },
  ];
  return filterByQuery(all, query, ['title']);
};
