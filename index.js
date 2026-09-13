const fs = require('fs');
const tags = require('./dist/tags.json');


const getFirstLetter = (tag) => tag.charAt(0).toLowerCase()
const isCyrillicLetter = (str) => /[а-яё]/i.test(str)

const tagsSortedByCount = tags.slice().sort((a, b) => b.count - a.count)
const maxTagCount = tagsSortedByCount[0]?.count || 0
const minTagCount = tagsSortedByCount[tagsSortedByCount.length - 1]?.count || 0
const totalTags = tags.length

const normalizedByFirstLetter = tags.reduce((acc, tag) => {
  const firstLetter = getFirstLetter(tag.tag)

  if (!isCyrillicLetter(firstLetter)) {
    return acc
  }

  if (!acc[firstLetter]) {
    acc[firstLetter] = []
  }

  acc[firstLetter].push([tag.tag, tag.count])

  return acc
},{})

// Внутри буквы теги идут по алфавиту — так их и рисует облако на me.yanke.ru.
// Раньше тут считались два порядка сразу, но оба .sort() правили одни и те же
// массивы на месте, поэтому сортировка по количеству ничего не значила.
const sortByName = Object.entries(normalizedByFirstLetter).reduce((acc, [letter, tags]) => {
  acc[letter] = tags.sort(([aName], [bName]) => aName.localeCompare(bName))

  return acc
},{})

fs.writeFileSync('./html/tags.js', `var meStat=${JSON.stringify({totalTags,maxTagCount,minTagCount,tags:sortByName})}`, 'utf-8')
