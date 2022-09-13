// require("dotenv").config();
const express = require("express");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const http = require("http");
const app = express();
const { URL } = require("url");
const WebSocket = require("ws");
const log = console.log;
const bcrypt = require("bcrypt");

const { MongoClient, ObjectId } = require("mongodb");
const { type } = require("os");
const server = http.createServer(app);
const MONGODB_ADDON_URI =
  "mongodb://umlfeyenib2sibznbt8g:6Qq0AvcwdM9gOlCjAtic@n1-c2-mongodb-clevercloud-customers.services.clever-cloud.com:27017,n2-c2-mongodb-clevercloud-customers.services.clever-cloud.com:27017/b9zevpat0grksh6?replicaSet=rs0";

const client = new MongoClient(MONGODB_ADDON_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = client.db("b9zevpat0grksh6");

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(express.json());
app.use(express.static("public")); //мидлваре для дачи статич файлов из папки public
app.use(cookieParser());

const wss = new WebSocket.Server({ clientTracking: false, noServer: true }); //сервер в полной изоляции
const clients = new Map();

// возвращает куки с указанным name,
// или undefined, если ничего не найдено
function getCookie(name, str) {
  // try {
  let matches = str.match(
    new RegExp(
      "(?:^|; )" +
        name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") +
        "=([^;]*)"
    )
  );
  // log('matches=', matches)
  // } catch (error) {
  //   log(error)
  //   throw error
  // }
  return matches ? decodeURIComponent(matches[1]) : undefined;
}

const auth = () => async (req, res, next) => {
  // console.log('req.cookies["sessionId"]=', req.cookies["sessionId"]);
  if (!req.cookies["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.cookies["sessionId"]);

  // console.log("user=", user);
  req.user = user; //прицепляем к req user
  req.sessionId = req.cookies["sessionId"];
  req.token = req.cookies["token"];
  next();
};

const hash = async (d) => {
  const salt = await bcrypt.genSalt(6);
  const hashed = await bcrypt.hash(d, salt).then((res) => res);
  // console.log("hashed=", hashed);
  return hashed;
};

const createNewUser = async (username, password) => {
  const passwordHash = await hash(password);
  const newUser = {
    name: username,
    password: passwordHash,
  };

  const newUserServer = await db
    .collection("users")
    .insertOne({ name: username, password: passwordHash });

  return newUserServer;
};

const findUserByUsername = async (username) => {
  const a = await db.collection("users").findOne({ name: username });
  // console.log("a=", a);
  return a;
};

const findUserBySessionId = async (sessionId) => {
  const session = await db.collection("sessions").findOne(
    { sessionId: sessionId }
    // {
    //   projection: { userId: 1 },   //сузить запрос
    // }
  );
  if (!session) {
    return;
  }
  return db.collection("users").findOne({ _id: ObjectId(session.userId) });
};

const findUserByToken = async (token) => {
  const session = await db.collection("sessions").findOne(
    { token: token }
    // {
    //   projection: { userId: 1 },   //сузить запрос
    // }
  );
  if (!session) {
    return;
  }
  return db.collection("users").findOne({ _id: ObjectId(session.userId) });
};

const createSession = async (userId, token) => {
  const sessionId = nanoid();
  await db.collection("sessions").insertOne({ userId, sessionId, token });
  return sessionId;
};

const deleteSession = async (sessionId) => {
  await db.collection("sessions").deleteOne({ sessionId });
};

// const user = null;
app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user !== false ? req.user : req.query.user,
    authError:
      req.query.authError === "true"
        ? "Wrong username or password"
        : req.query.authError,
  });
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

app.post(
  "/login",
  bodyParser.urlencoded({ extended: false }),
  async (req, res) => {
    const { username, password } = req.body;
    const user = await findUserByUsername(username);
    const validPassword = await bcrypt.compare(password, user.password);
    if (!user || !validPassword) {
      return res.redirect("/?authError=true");
    }
    const token = nanoid();
    const sessionId = await createSession(user._id, token); //открываем новую сесиссию
    // log("sessionId=", sessionId)
    res
      .cookie("sessionId", sessionId, { httpOnly: true, maxAge: 100000 })
      .redirect(`/?user=${user.name}&token=${token}`); //отправляем куки еще нужно sign
  }
);

server.on("upgrade", async (req, socket, head) => {
  //событие upgrade сраб на http когда клиент посылает серверу запрос сервере решаем разрешить соед или нет
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`); //распарсим URL
  const token = searchParams && searchParams.get("token");
  log("token1=", token);
  const userId = await findUserByToken(token);
  if (!userId) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  req.userId = userId;
  wss.handleUpgrade(req, socket, head, (ws) => {
    //вызываем вручную событие haldle апгрэйд и получаем инстанс сокета
    // log("ws=", ws)
    wss.emit("connection", ws, req); //событие connection сгенерировали сами
  });
});

wss.on("connection", (ws, req) => {
  //это событие только сгенерировали emmit
  const { userId } = req; //извлекаем userId
  clients.set(userId, ws); //исп maps связываем userid и вебсокет и запоминаем в списке  clients
  ws.on("close", () => {
    clients.delete(userId);
  });
  ws.on("message", async (message) => {
    let data;
    let session;
    try {
      data = JSON.parse(message);
      // log('data=', data)
      // log('req.headers.cookie=', req.headers.cookie)
      session = getCookie("sessionId", req.headers.cookie);
      // log("getCookie('sessionId')=", session)
    } catch (error) {
      log(error);
      return;
    }
    if (data.type === "all_timers") {
      //выделяем
      const timersWork = await db
        .collection("timers")
        .find({
          "timer.sessionId": session,
          // "timer.isActive": true,
        })
        .toArray()
        .then((results) => results);
      timersWork.map((item) => {
        item.timer.progress = Date.now() - item.timer.start;
      });
      const fullMessage = JSON.stringify({
        type: "all_timers",
        allTimers: timersWork,
      });
      // log('timersWork=', timersWork)
      ws.send(fullMessage);
    }
  });
});

app.post(
  "/signup",
  bodyParser.urlencoded({ extended: false }),
  async (req, res) => {
    //только здесь исп body parser сюда и подключаем
    const { username, password } = req.body; //имена атрибутов соответ именам инпутов и эйчтиэмл
    const user = await findUserByUsername(username);
    if (user) {
      return res.redirect("/?authError=true");
    }
    const newUserId = await createNewUser(username, password);
    const newUserResp = await db
      .collection("users")
      .findOne({ _id: newUserId.insertedId });

    console.log("newUserResp=", newUserResp);
    const sessionId = await createSession(newUserId.insertedId);
    // req.user = user;
    res
      .cookie("sessionId", sessionId, { httpOnly: true })
      .redirect(`/?user=${newUserResp.name}`); //maxAge: 100000
  }
);

app.post("/api/timers/:user", async (req, res) => {
  const startTime = Date.now();
  const timer = {
    start: startTime,
    description: `Timer  ${req.body.description}`,
    isActive: true,
    id: nanoid(),
    sessionId: req.cookies.sessionId,
  };
  // console.log("req.cookies.sessionId=", req.cookies.sessionId);
  await db.collection("timers").insertOne({
    timer,
  });
  res.send(timer);
});

app.post("/api/timers/:id/stop", async (req, res) => {
  const idTimer = req.params.id;
  // console.log("idTimer=", idTimer);

  const timeStop = Date.now();
  // const timerStop = {
  //   start: startTime,
  //   description: `Timer  ${req.body.description}`,
  //   isActive: false,
  // };
  try {
    const updatedTimer = await db.collection("timers").findOneAndUpdate(
      { "timer.id": idTimer },
      {
        $set: {
          "timer.isActive": false,
          "timer.end": timeStop,
          "timer.duration": timeStop,
        },
      },
      {
        returnOriginal: false,
      }
    );
    res.send(updatedTimer);
  } catch (error) {
    console.error(error.message);
  }
});

app.use("/api/timers", async (req, res) => {
  if (req.query.isActive === "true") {
    const timersWork = await db
      .collection("timers")
      .find({
        "timer.sessionId": req.cookies.sessionId,
        "timer.isActive": true,
      })
      .toArray()
      .then((results) => results);
    // console.log("timersWork=", timersWork);
    timersWork.map((item) => {
      item.timer.progress = Date.now() - item.timer.start;
    });
    res.send(timersWork);
  }

  if (req.query.isActive === "false") {
    const timersStop = await db
      .collection("timers")
      .find({
        "timer.sessionId": req.cookies.sessionId,
        "timer.isActive": false,
      })
      .toArray()
      .then((results) => results);
    res.send(timersStop);
  }
});

const port = process.env.PORT || 4000;
const portWss = 4001;
// app.listen(port, () => {
//   console.log(`  Listening on http://localhost:${port}`);
// });

server.listen(portWss, () => {
  console.log(`ws listening on  http://localhost:${portWss}`);
});
