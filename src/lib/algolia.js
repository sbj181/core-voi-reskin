const dotenv = require("dotenv");
dotenv.config();

const algoliasearch = require("algoliasearch");
const client = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_WRITE_API_KEY
);

// Import resources data
const resourcesData = require('../data/resources.json');

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const removeMd = require("remove-markdown");

// Function to find image URL from resources data
const findImageUrl = (title) => {
  const resource = resourcesData.resources.find(r => r.title === title);
  return resource ? resource.imageSrc : null;
};


// Function to strip import statements and similar code
const stripCodeContent = (content) => {
  return content.replace(/import .+?;?(\n|$)/g, '');
};

// Function to get the size of an object in bytes
const sizeof = obj => {
  return Buffer.from(JSON.stringify(obj)).length;
};

// Algolia's maximum record size (in bytes)
const ALGOLIA_MAX_SIZE = 10000; // 10KB

// Function to truncate the content of a record to fit Algolia's size limit
const truncateToFit = record => {
  let truncatedRecord = { ...record };
  while (sizeof(truncatedRecord) > ALGOLIA_MAX_SIZE) {
    truncatedRecord.content = truncatedRecord.content.slice(0, -100); // Remove the last 100 characters
    if (!truncatedRecord.content) break; // Stop if content is empty
  }
  return truncatedRecord;
};

const readFilesRecursively = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = entries.filter(file => !file.isDirectory()).map(file => path.join(directory, file.name));
  const folders = entries.filter(folder => folder.isDirectory());

  folders.forEach(folder => {
    files.push(...readFilesRecursively(path.join(directory, folder.name)));
  });

  return files;
};

const directoryPath = "./src/content/docs/en";
const filenames = readFilesRecursively(directoryPath).filter(filename => {
  return path.extname(filename) === '.mdx' && !filename.endsWith('index.mdx'); // Exclude index.mdx files
});

const splitContentByHeadings = (content, title) => {
  const splitByH2 = content.split(/##\s+/).slice(1);
  const splitByH3 = content.split(/###\s+/).slice(1);

  return {
    lvl0: splitByH2[0] || null,
    lvl1: title,
    lvl2: splitByH3[0] || null,
  };
};

const data = filenames.map(filename => {
  try {
    const markdownWithMeta = fs.readFileSync(filename, 'utf8');
    const { data: frontmatter, content } = matter(markdownWithMeta);
    
    const levels = splitContentByHeadings(content, frontmatter.title);

    const relativePath = path.relative(directoryPath, filename);
    const urlSlug = relativePath.replace(/\.mdx$/, '');
    const url = `/${urlSlug}`;

    const imageUrl = findImageUrl(frontmatter.title); // Find image URL for this page

    const parentFolderName = path.dirname(relativePath).split(path.sep).pop().replace(/-/g, ' ');

    const object = {
      objectID: frontmatter.slug,
      title: frontmatter.title,
      image: imageUrl,
      description: frontmatter.description || '', // Include the description
      content: removeMd(stripCodeContent(content)).replace(/\n/g, ""), // Strip code content and then remove Markdown
      url: url,
      folder: parentFolderName,
      ...levels
    };

    const truncatedObject = truncateToFit(object);

    console.log('Truncated Object:', truncatedObject);

    return truncatedObject;
  } catch (e) {
    console.log('Error reading file:', filename, e.message);
  }
}).filter(Boolean);

console.log('Data:', data); 

client
  .initIndex(process.env.ALGOLIA_INDEX_NAME)
  .saveObjects(data, { autoGenerateObjectIDIfNotExist: true })
  .then(res => console.log(res))
  .catch(err => console.error(err));
