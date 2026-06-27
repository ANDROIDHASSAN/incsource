// Base skill vocabulary for JD parsing. At match time this is unioned with the
// live skills present in the candidate DB, so extraction always covers what can match.

export const BASE_SKILLS = [
  // languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'C', 'Go', 'Golang', 'Rust', 'Ruby',
  'PHP', 'Kotlin', 'Swift', 'Scala', 'R', 'Dart', 'Objective-C', 'Perl', 'Elixir',
  // frontend
  'React', 'React.js', 'React Native', 'Next.js', 'Redux', 'Vue', 'Vue.js', 'Angular', 'Svelte',
  'HTML', 'HTML5', 'CSS', 'CSS3', 'SASS', 'SCSS', 'Tailwind', 'Tailwind CSS', 'Bootstrap',
  'jQuery', 'Webpack', 'Vite', 'Material UI', 'Chakra UI', 'Three.js',
  // backend
  'Node.js', 'Express', 'Express.js', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring',
  'Spring Boot', 'Laravel', 'Rails', 'Ruby on Rails', '.NET', 'ASP.NET', 'GraphQL', 'REST',
  'REST API', 'REST APIs', 'Microservices', 'gRPC', 'Socket.io',
  // data / db
  'MongoDB', 'PostgreSQL', 'MySQL', 'SQL', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB',
  'Oracle', 'SQLite', 'Firebase', 'Supabase', 'Prisma', 'Sequelize', 'Mongoose',
  // data science / ML
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn',
  'Pandas', 'NumPy', 'NLP', 'Computer Vision', 'Data Science', 'Data Analysis', 'Spark',
  'Hadoop', 'Tableau', 'Power BI', 'Generative AI', 'LangChain', 'LLM', 'OpenAI',
  // devops / cloud
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins',
  'CI/CD', 'Ansible', 'Linux', 'Nginx', 'Git', 'GitHub', 'GitLab', 'DevOps', 'Cloud Computing',
  // mobile
  'Android', 'iOS', 'Flutter', 'Xamarin', 'SwiftUI',
  // qa / testing
  'Selenium', 'Cypress', 'Jest', 'Playwright', 'JUnit', 'Appium', 'TestNG', 'API Testing',
  'Automation Testing', 'Manual Testing',
  // stacks / misc
  'MERN', 'MEAN', 'Full Stack', 'Full-Stack', 'Frontend', 'Backend', 'Agile', 'Scrum', 'JIRA',
  'Kafka', 'RabbitMQ', 'WebSockets', 'OOP', 'Data Structures', 'Algorithms', 'System Design',
  // non-tech (so it works for any role)
  'Sales', 'Marketing', 'SEO', 'Content Writing', 'Recruitment', 'HR', 'Operations',
  'Project Management', 'Product Management', 'Business Development', 'Customer Success',
  'Accounting', 'Finance', 'Excel', 'Communication', 'Leadership',
];

// Normalize a skill so "React.js", "reactjs", "React JS" all compare equal.
export function normSkill(s) {
  return String(s || '').toLowerCase().replace(/[.\s_-]+/g, '').replace(/js$/, '').trim();
}

// Common aliases that don't normalize to the same token.
export const SKILL_ALIASES = {
  golang: 'go', reactnative: 'reactnative', nodejs: 'node', 'react.js': 'react',
  postgres: 'postgresql', k8s: 'kubernetes', ml: 'machinelearning', ai: 'generativeai',
  restapi: 'rest', restapis: 'rest', 'ci/cd': 'cicd',
};
