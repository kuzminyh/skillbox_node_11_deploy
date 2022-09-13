/*global UIkit, Vue */
// import ws from "ws"
(() => {
  // import ws from "ws"
  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  const fetchJson = (...args) =>
    fetch(...args)
      .then((res) =>
        res.ok
          ? res.status !== 204
            ? res.json()
            : null
          : res.text().then((text) => {
              throw new Error(text);
            })
      )
      .catch((err) => {
        alert(err.message);
      });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
      client: null,
    },
    methods: {
      // fetchActiveTimers() {
      //   fetchJson("/api/timers?isActive=true").then((activeTimers) => {
      //     this.activeTimers = activeTimers;
      //   });
      // },
      // fetchOldTimers() {
      //   fetchJson("/api/timers?isActive=false").then((oldTimers) => {
      //     this.oldTimers = oldTimers;
      //   });
      // },
      createTimer() {
        const paramString = document.location.search;
        const searchUser = new URLSearchParams(paramString);
        const userSearch = searchUser.get("user");
        console.log("user=", userSearch);
        const description = this.desc;
        this.desc = "";
        fetchJson(`/api/timers/${userSearch}`, {
          method: "post",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description, user: userSearch }),
        }).then(({ id }) => {
          info(`Created new timer "${description}" [${id}]`);
        });
        this.client.send(
          JSON.stringify({
            type: "all_timers",
            message: "i want to get timers",
          })
        );
      },
      stopTimer(id) {
        fetchJson(`/api/timers/${id}/stop`, {
          method: "post",
        }).then(() => {
          info(`Stopped the timer [${id}]`);
          this.client.send(
            JSON.stringify({
              type: "all_timers",
              message: "i want to get timers",
            })
          );
          // this.fetchActiveTimers();
          // this.fetchOldTimers();
        });
      },
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      const log = console.log;
      this.client = new WebSocket(
        `${wsProto}//${location.host}?token=${token}`
      ); //полный URL для открытия сокета
      this.client.onopen = () => {
        log('document.cookie("sessionId")=', document.cookie);
        this.client.send(
          JSON.stringify({
            type: "all_timers",
            message: "i want to get timers",
            // sessionId: document.cookie('sessionId')
          })
        );
      };

      this.client.onmessage = (message) => {
        //подписываемся на все сообщ от сервера
        let data;
        try {
          data = JSON.parse(message.data);
        } catch (error) {
          log(error);
          return;
        }
        if (data.type === "all_timers") {
          const workTimers = data.allTimers.filter((e) => e.timer.isActive);
          const oldTimers = data.allTimers.filter((e) => !e.timer.isActive);
          this.activeTimers = workTimers;
          this.oldTimers = oldTimers;
          log("this.activeTimers=", this.activeTimers);
        }
      };
      setInterval(() => {
        this.client.send(
          JSON.stringify({
            type: "all_timers",
            message: "i want to get timers",
          })
        );
      }, 1000);
    },
  });
})();
