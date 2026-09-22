const fs = require('fs');
const tags = require('./dist/tags.json');


const getFirstLetter = (tag) => tag.charAt(0).toLowerCase()
const isCyrillicLetter = (str) => /[а-яё]/i.test(str)

const tagsSortedByCount = tags.slice().sort((a, b) => b.count - a.count)
const maxTagCount = tagsSortedByCount[0]?.count || 0
const minTagCount = tagsSortedByCount[tagsSortedByCount.length - 1]?.count || 0
const totalTags = tags.length

// Теги на цифру и латиницу раньше отбрасывались — их набиралось около сотни,
// и в облаке на me.yanke.ru они не появлялись вовсе. Теперь им отведена своя
// корзина.
const symbolKey = '#'

const normalizedByFirstLetter = tags.reduce((acc, tag) => {
  const firstLetter = getFirstLetter(tag.tag)
  const key = isCyrillicLetter(firstLetter) ? firstLetter : symbolKey

  if (!acc[key]) {
    acc[key] = []
  }

  acc[key].push([tag.tag, tag.count])

  return acc
},{})

// Порядок ключей задаёт порядок букв в шапке, а вставляются они в том порядке,
// в каком попались теги. Раскладываем явно: буквы по алфавиту, корзина с
// цифрами и латиницей — в конец.
const orderedKeys = Object.keys(normalizedByFirstLetter)
  .filter((key) => key !== symbolKey)
  .sort((a, b) => a.localeCompare(b))

if (normalizedByFirstLetter[symbolKey]) {
  orderedKeys.push(symbolKey)
}

// Внутри буквы теги идут по алфавиту — так их и рисует облако на me.yanke.ru.
// Раньше тут считались два порядка сразу, но оба .sort() правили одни и те же
// массивы на месте, поэтому сортировка по количеству ничего не значила.
const sortByName = orderedKeys.reduce((acc, letter) => {
  acc[letter] = normalizedByFirstLetter[letter].sort(([aName], [bName]) => aName.localeCompare(bName))

  return acc
},{})

fs.writeFileSync('./html/tags.js', `var meStat=${JSON.stringify({totalTags,maxTagCount,minTagCount,tags:sortByName})}`, 'utf-8')
