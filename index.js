const fs = require('fs');
const tags = require('./dist/tags.json');

const content = tags.map(tag => ([tag.tag, tag.count]))

fs.writeFileSync('./html/tags.js', `var meTags=${JSON.stringify(content)}`, 'utf-8')
