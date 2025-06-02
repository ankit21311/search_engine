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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

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

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Routes
app.get("/", (req, res) => {
  try {
    res.render("index");
  } catch (error) {
    console.error('Error rendering index:', error);
    res.status(500).send('Error loading page');
  }
});

// Search route
app.get("/search", async (req, res) => {
  try {
    const query = req.query.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

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

    // Process query words
    for (let j = 0; j < newString.length; j++) {
      newString[j] = newString[j].toLowerCase();
      newString[j] = removePunc(newString[j]);
      if (newString[j] !== "") queryKeywords.push(newString[j]);

      var letr = newString[j].match(/[a-zA-Z]+/g);
      if (letr) {
        letr.forEach((w) => {
          queryKeywords.push(removePunc(w.toLowerCase()));
        });
      }

      let x = wordsToNumbers(newString[j]).toString();
      if (x != newString[j]) queryKeywords.push(x);
    }

    // Process keywords
    let queryKeywordsNew = [...queryKeywords];
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

    // Filter and process keywords
    queryKeywords = queryKeywordsNew.filter(keyword => 
      keywords.indexOf(keyword) !== -1
    );
    
    queryKeywords = [...new Set(queryKeywords)].sort();

    let qid = queryKeywords.map(key => keywords.indexOf(key));

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

    for (let i = 0; i < 10 && i < arr.length; i++) {
      if (arr[i].sim != 0) nonZero++;
      try {
        const str = path.join(__dirname, "Problems");
        const str1 = path.join(str, `problem_text_${arr[i].id + 1}.txt`);
        
        if (!fs.existsSync(str1)) {
          console.error(`File not found: ${str1}`);
          continue;
        }

        let question = fs.readFileSync(str1).toString().split("\n");
        let problem = arr[i].id <= 1773 
          ? `${question[0].split("ListShare")[1]} ${question[1] || ''}`
          : `${question[0]} ${question[1] || ''}`;
        
        response.push({
          id: arr[i].id,
          title: titles[arr[i].id],
          problem: problem.trim(),
        });
      } catch (error) {
        console.error(`Error processing result ${i}:`, error);
      }
    }

    setTimeout(() => {
      res.json(nonZero ? response : []);
    }, 1000);

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Question route
app.get("/question/:id", (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id) || id < 0 || id >= N) {
      console.error('Invalid ID:', req.params.id);
      return res.redirect('/');
    }

    const str = path.join(__dirname, "Problems");
    const str1 = path.join(str, `problem_text_${id + 1}.txt`);

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

    text = text.replace(/\n/g, "<br/>");

    let title = titles[id];
    if (!title) {
      console.error('Title not found for id:', id);
      return res.redirect('/');
    }

    title = title.split("-").join(" ").trim().capitalize();

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

// Debug route
app.get("/debug/file/:id", (req, res) => {
  try {
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
  } catch (error) {
    console.error('Debug route error:', error);
    res.status(500).json({ error: 'Debug failed' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Start server
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});