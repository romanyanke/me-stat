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

const sortByCount = Object.entries(normalizedByFirstLetter).reduce((acc, [letter, tags]) => {
  acc[letter] = tags.sort(([,aCount], [,bCount]) => bCount - aCount)

  return acc
},{})

fs.writeFileSync('./html/tags.js', `var meStat=${JSON.stringify({totalTags,maxTagCount,minTagCount,tags:sortByCount})}`, 'utf-8')
