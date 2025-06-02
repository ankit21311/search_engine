const express = require("express");
const ejs = require("ejs");
const { removeStopwords } = require("stopword");
const removePunc = require("remove-punctuation");
const natural = require("natural");
const lemmatizer = require("wink-lemmatizer");
const converter = require("number-to-words");
const fs = require("fs");
const path = require("path");
const stringSimilarity = require("string-similarity");
const { wordsToNumbers } = require("words-to-numbers");

// Reading Required Arrays
const IDF = require("./idf");
const keywords = require("./keywords");
const length = require("./length");
let TF = require("./TF");
const titles = require("./titles");
const urls = require("./urls");

const N = 3023;
const W = 27602;
const avgdl = 138.27125372146875;

// Starting the Server
const app = express();

// Function to capitalize the string
Object.defineProperty(String.prototype, "capitalize", {
  value: function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
  },
  enumerable: false,
});

// Helper function to check file existence
function isValidFilePath(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    console.error('Error checking file path:', error);
    return false;
  }
}

// Setting EJS as view engine
app.set("view engine", "ejs");

// Static files directory
app.use(express.static(path.join(__dirname, "/public")));

// Making a dictionary with all keywords
const spellcheck = new natural.Spellcheck(keywords);

// Home page route
app.get("/", (req, res) => {
  res.render("index");
});

// Search route
app.get("/search", (req, res) => {
  const query = req.query.query;
  const oldString = query.split(" ");
  const newString = removeStopwords(oldString);
  newString.sort();

  let queryKeywords = [];

  // Handle numbers in query
  let getNum = query.match(/\d+/g);
  if (getNum) {
    getNum.forEach((num) => {
      queryKeywords.push(num);
      let numStr = converter.toWords(Number(num));
      let numKeys = numStr.split("-");
      queryKeywords.push(numStr);

      numKeys.forEach((key) => {
        let spaceSplits = key.split(" ");
        if (numKeys.length > 1) queryKeywords.push(key);
        if (spaceSplits.length > 1)
          spaceSplits.forEach((key) => {
            queryKeywords.push(key);
          });
      });
    });
  }

  // Process each word in query
  for (let j = 0; j < newString.length; j++) {
    newString[j] = newString[j].toLowerCase();
    newString[j] = removePunc(newString[j]);
    if (newString[j] !== "") queryKeywords.push(newString[j]);

    // Handle camelCase
    var letr = newString[j].match(/[a-zA-Z]+/g);
    if (letr) {
      letr.forEach((w) => {
        queryKeywords.push(removePunc(w.toLowerCase()));
      });
    }

    // Convert words to numbers
    let x = wordsToNumbers(newString[j]).toString();
    if (x != newString[j]) queryKeywords.push(x);
  }

  // Grammar and Spell Check
  let queryKeywordsNew = queryKeywords;
  queryKeywords.forEach((key) => {
    let key1 = key;
    let key2 = lemmatizer.verb(key1);
    queryKeywordsNew.push(key2);

    let spellkey1 = spellcheck.getCorrections(key1);
    let spellkey2 = spellcheck.getCorrections(key2);
    if (spellkey1.indexOf(key1) == -1) {
      spellkey1.forEach((k1) => {
        queryKeywordsNew.push(k1);
        queryKeywordsNew.push(lemmatizer.verb(k1));
      });
    }

    if (spellkey2.indexOf(key2) == -1) {
      spellkey2.forEach((k2) => {
        queryKeywordsNew.push(k2);
        queryKeywordsNew.push(lemmatizer.verb(k2));
      });
    }
  });

  queryKeywords = queryKeywordsNew;

  // Filter keywords present in dataset
  let temp = [];
  for (let i = 0; i < queryKeywords.length; i++) {
    const id = keywords.indexOf(queryKeywords[i]);
    if (id !== -1) {
      temp.push(queryKeywords[i]);
    }
  }

  queryKeywords = temp;
  queryKeywords.sort();

  // Get unique keywords
  let temp1 = [];
  queryKeywords.forEach((key) => {
    if (temp1.indexOf(key) == -1) {
      temp1.push(key);
    }
  });

  queryKeywords = temp1;

  // Get keyword IDs
  let qid = [];
  queryKeywords.forEach((key) => {
    qid.push(keywords.indexOf(key));
  });

  // BM25 Algorithm
  const arr = [];

  for (let i = 0; i < N; i++) {
    let s = 0;
    qid.forEach((key) => {
      const idfKey = IDF[key];
      let tf = 0;
      for (let k = 0; k < TF[i].length; k++) {
        if (TF[i][k].id == key) {
          tf = TF[i][k].val / length[i];
          break;
        }
      }
      const tfkey = tf;
      const x = tfkey * (1.2 + 1);
      const y = tfkey + 1.2 * (1 - 0.75 + 0.75 * (length[i] / avgdl));
      let BM25 = (x / y) * idfKey;

      if (i < 2214) BM25 *= 2;
      s += BM25;
    });

    const titSim = stringSimilarity.compareTwoStrings(
      titles[i],
      query.toLowerCase()
    );
    s *= titSim;

    arr.push({ id: i, sim: s });
  }

  arr.sort((a, b) => b.sim - a.sim);

  let response = [];
  let nonZero = 0;

  for (let i = 0; i < 10; i++) {
    if (arr[i].sim != 0) nonZero++;
    try {
      const str = path.join(__dirname, "Problems");
      const str1 = path.join(str, `problem_text_${arr[i].id + 1}.txt`);
      
      if (!fs.existsSync(str1)) {
        console.error(`File not found: ${str1}`);
        continue;
      }

      let question = fs.readFileSync(str1).toString().split("\n");
      let n = question.length;
      let problem = "";

      if (arr[i].id <= 1773) {
        problem = question[0].split("ListShare")[1] + " ";
        if (n > 1) problem += question[1];
      } else {
        problem = question[0] + " ";
        if (n > 1) problem += question[1];
      }
      
      response.push({
        id: arr[i].id,
        title: titles[arr[i].id],
        problem: problem,
      });
    } catch (error) {
      console.error(`Error processing result ${i}:`, error);
    }
  }

  setTimeout(() => {
    if (nonZero) res.json(response);
    else res.json([]);
  }, 1000);
});

// Question page route
app.get("/question/:id", (req, res) => {
  try {
    const id = Number(req.params.id);

    // Validate ID
    if (isNaN(id) || id < 0 || id >= N) {
      console.error('Invalid ID:', req.params.id);
      return res.redirect('/');
    }

    const str = path.join(__dirname, "Problems");
    const str1 = path.join(str, `problem_text_${id + 1}.txt`);

    // Check file existence
    if (!fs.existsSync(str1)) {
      console.error('Problem file not found:', str1);
      return res.redirect('/');
    }

    let text = fs.readFileSync(str1).toString();

    if (id <= 1773) {
      const parts = text.split("ListShare");
      if (parts.length > 1) {
        text = parts[1];
      } else {
        console.error('Invalid format for Leetcode problem:', id);
        return res.redirect('/');
      }
    }

    // Format text
    text = text.replace(/\n/g, "<br/>");

    // Process title
    let title = titles[id];
    if (!title) {
      console.error('Title not found for id:', id);
      return res.redirect('/');
    }

    title = title.split("-").join(" ").trim().capitalize();

    // Determine problem type
    let type = id < 1774 ? "Leetcode" : 
               id < 2214 ? "Interview Bit" : 
               "Techdelight";

    const questionObject = {
      title,
      link: urls[id] || '#',
      value: text,
      type,
    };

    res.locals.questionObject = questionObject;
    res.render("question");

  } catch (error) {
    console.error('Error in /question/:id route:', error);
    res.redirect('/');
  }
});

// Debug endpoint
app.get("/debug/file/:id", (req, res) => {
  const id = Number(req.params.id);
  const str = path.join(__dirname, "Problems");
  const str1 = path.join(str, `problem_text_${id + 1}.txt`);
  
  res.json({
    requestedId: req.params.id,
    numericId: id,
    problemsDir: str,
    fullPath: str1,
    fileExists: fs.existsSync(str1),
    dirExists: fs.existsSync(str),
    currentDir: __dirname
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server is running on port " + port);
});