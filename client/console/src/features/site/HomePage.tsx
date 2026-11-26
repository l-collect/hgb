import { useEffect, type CSSProperties } from "react";
import { Mark } from "../../components/ui";
import { Link, paths } from "../../router";
import s from "./Home.module.css";

const repoUrl = `https://github.com/${import.meta.env.VITE_CODE_REPO}`;

const steps = [
  ["装上护肝宝并登录", "在安卓手机上安装并登录。设备会自动出现在网页控制台。"],
  ["选账号、选任务、定时间", "在网页或 App 里给每个游戏账号选好任务和设置，再设一个每天几点开始的计划。"],
  ["到点自动跑，跑完告诉你", "护肝宝按计划开始，需要时先切到对应账号。结果推到钉钉、企业微信、Bark、邮箱或手机通知。"],
];
const features = [
  ["定时计划", "按星期和时间自动开始；过了最晚开始时间就不硬跑，并记下原因。", "M12 7v5l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  ["多个游戏账号", "主号、小号各有自己的设置和计划；跑之前核对游戏里登录的账号，自动切号正在调试。", "M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0M18 4l2 2-2 2"],
  ["多台设备一起用", "每台设备上的游戏都是执行者；服务端按账号把任务分给登录着它、或空闲能切号的那一个。", "M3 5h12v9H3zM17 8h4v11h-4zM7 18h4"],
  ["人不在也能管", "在网页上暂停、停止、立即运行，看到每台设备正在做什么。", "M4 5h16v11H4zM9 20h6M12 16v4"],
  ["每一步都有记录", "每次运行按步骤记下来：在哪停住、为什么停住，一看就知道。", "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"],
  ["出事第一时间知道", "连续失败、设备掉线、结果需要你确认时，按你打开的规则推送。", "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"],
];
const trust = [
  ["不问游戏密码", "切号只从游戏自己记住的账号里选。"],
  ["看不懂就停下", "遇到不认识的弹窗或验证，停下来等你处理。"],
  ["结果说实话", "没法确认的结果标为“待核对”，不假装成功。"],
  ["每一步看得见", "运行记录按步骤列出点了哪里、用了多久，在哪停下、为什么停下。"],
];
const faq = [
  ["需要 Root 吗？", "不需要。护肝宝用系统的无障碍和截图能力操作游戏界面。"],
  ["会保存我的游戏密码吗？", "不会。护肝宝只记下账号是谁（编号和游戏昵称），切号时从游戏记住的账号里选。"],
  ["支持哪些游戏？", "第一个支持的是阴阳师，任务正在调试。护肝宝在 GitHub 开源，以后会开放给开发者在 App 里做步骤、调试、上传，给新游戏做任务。"],
  ["电脑能用吗？", "Windows 版在计划中，会支持游戏多开；现在可以先用网页控制台管理手机上的任务。"],
];

/** The site's home page, shown at "/" to a visitor who is not signed in; signed in, "/" is the console. */
export function HomePage() {
  useEffect(() => { document.title = "护肝宝 · 日常交给它，你去睡觉"; return () => { document.title = "护肝宝控制台"; }; }, []);
  return (
    <div className={s.home}>
      <a className={s.skip} href="#main">跳到正文</a>
      <header className={s.top}>
        <nav className={s.bar} aria-label="网站导航">
          <Link className={s.brand} to="/" aria-label="护肝宝首页"><Mark /><span>护肝宝</span></Link>
          <div className={s.links}>
            <a href="#how">怎么用</a><a href="#features">功能</a><a href="#games">支持的游戏</a><a href="/docs/">文档</a>
          </div>
          <a className={s.docs} href="/docs/">文档</a>
          <Link className={`${s.cta} ${s.small} ${s.primary}`} to={paths.login}>登录控制台</Link>
        </nav>
      </header>

      <main id="main">
        <section className={`${s.hero} ${s.wrap}`} aria-labelledby="hero">
          <div className={s.heroText}>
            <span className={s.tag}>安卓 · 网页控制台 · Windows 计划中</span>
            <h1 id="hero">日常交给护肝宝，<br />你去睡觉。</h1>
            <p className={s.lead}>护肝宝在你的手机上，替你把游戏里每天重复的日常跑完。到点自动开始，换账号、排队、跑完通知你，人不在也能在网页上看到每一步。</p>
            <div className={s.actions}>
              <a className={`${s.cta} ${s.primary}`} href="#download"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>获取护肝宝</a>
              <a className={`${s.cta} ${s.ghost}`} href="/docs/start/quick-start/">看看怎么用</a>
            </div>
            <p className={s.note}>不需要 Root · 不问游戏密码 · 每一步都有记录</p>
          </div>
          <div className={s.art} role="img" aria-label="示意：网页控制台显示两台设备正在运行，手机游戏上方有护肝宝的悬浮球和一条钉钉通知">
            <div className={s.console}>
              <div className={s.dots}><span /><span /><span /><em>控制台 · 设备</em></div>
              <div className={s.devices}>
                <div className={s.device}><b>我的手机</b><span className={`${s.pill} ${s.run}`}>运行中</span><span className={s.muted}>主号 · 日常巡游</span><i style={{ "--w": "62%" } as CSSProperties} /></div>
                <div className={s.device}><b>备用手机</b><span className={`${s.pill} ${s.run}`}>运行中</span><span className={s.muted}>小号 · 喂猫喂狗</span><i style={{ "--w": "30%" } as CSSProperties} /></div>
              </div>
              <ul className={s.runs}>
                <li><span>每日领取 · 主号</span><span className={s.muted}>06:30</span><b className={s.ok}>已完成</b></li>
                <li><span>花合战领取 · 小号</span><span className={s.muted}>06:42</span><b className={s.ok}>已完成</b></li>
                <li><span>日常巡游 · 主号</span><span className={s.muted}>现在</span><b className={s.info}>运行中</b></li>
              </ul>
            </div>
            <div className={s.phone}>
              <div className={s.screen}>
                <span className={s.bubble}>日常巡游 · 第 3/4 步</span>
                <span className={s.ball}><Mark size={26} /></span>
                <span className={s.toast}><b>钉钉 · 运维群</b><br />每日领取：全部完成</span>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className={s.band} aria-labelledby="howh">
          <div className={`${s.wrap} ${s.stack}`}>
            <h2 id="howh">三步用起来</h2>
            <ol className={s.steps}>
              {steps.map(([title, text], i) => <li key={title}><span className={s.num}>{i + 1}</span><b>{title}</b><span className={s.muted}>{text}</span></li>)}
            </ol>
          </div>
        </section>

        <section id="features" className={`${s.wrap} ${s.stack}`} aria-labelledby="feath">
          <h2 id="feath">它能替你做什么</h2>
          <div className={s.grid}>
            {features.map(([title, text, icon]) => (
              <article key={title} className={`${s.card} ${s.feature}`}>
                <span className={s.icon}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={icon} /></svg></span>
                <h3>{title}</h3><p className={s.muted}>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={s.wrap} aria-labelledby="trusth">
          <div className={s.trust}>
            <div><h2 id="trusth">放心交给它</h2><p>护肝宝只在你的设备上操作游戏界面，看不懂就停下来等你，不会为了跑完而乱点。</p></div>
            <ul>{trust.map(([title, text]) => <li key={title}><span aria-hidden="true">✓</span><span><b>{title}</b><span>{text}</span></span></li>)}</ul>
          </div>
        </section>

        <section id="games" className={`${s.wrap} ${s.stack}`} aria-labelledby="gamesh">
          <h2 id="gamesh">支持的游戏</h2>
          <div className={`${s.grid} ${s.two}`}>
            <article className={`${s.card} ${s.feature}`}>
              <div className={s.row}><h3>阴阳师</h3><span className={`${s.pill} ${s.run}`}>调试中</span></div>
              <p className={s.muted}>日常巡游、花合战领取、喂猫喂狗、每日礼包等，正在真机上调试；识别账号和自动切号也在调试。</p>
              <a href="/docs/games/onmyoji/">任务列表 →</a>
            </article>
            <article className={`${s.card} ${s.feature} ${s.dashed}`}>
              <h3>更多游戏</h3>
              <p className={s.muted}>护肝宝的动作是通用的，游戏相关的都写在任务包里；以后开发者可以在 App 里做步骤、调试、上传。</p>
              <a href="/docs/dev/task-bundles/">怎么给新游戏做任务 →</a>
            </article>
          </div>
        </section>

        <section id="download" className={`${s.band} ${s.soft}`} aria-labelledby="dl">
          <div className={`${s.wrap} ${s.download}`}>
            <div><h2 id="dl">现在开始</h2><p className={s.muted}>下载安卓版，用邮箱登录，设备会自动出现在控制台里。</p></div>
            <div className={s.downloads}>
              <a className={`${s.card} ${s.dl}`} href={`${repoUrl}/releases/latest`}><span><b>安卓版</b><span className={s.muted}>APK · Android 11 及以上</span></span><span className={s.go}>下载最新版</span></a>
              <div className={`${s.card} ${s.dl} ${s.off}`}><span><b>Windows 版</b><span className={s.muted}>计划中 · 将支持游戏多开</span></span><span className={`${s.go} ${s.muted}`}>敬请期待</span></div>
              <Link className={`${s.card} ${s.dl}`} to={paths.login}><span><b>网页控制台</b><span className={s.muted}>不用安装，管理所有设备</span></span><span className={s.go}>打开</span></Link>
            </div>
          </div>
        </section>

        <section className={`${s.wrap} ${s.narrow} ${s.stack}`} aria-labelledby="faqh">
          <h2 id="faqh">常见问题</h2>
          {faq.map(([q, a]) => <details key={q} className={s.card}><summary>{q}</summary><p className={s.muted}>{a}</p></details>)}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/** The links at the foot of the home page, privacy and terms. */
export function SiteFooter() {
  return (
    <footer className={s.foot}>
      <div className={`${s.wrap} ${s.row}`}>
        <span className={`${s.brand} ${s.brandSmall}`}><Mark size={22} />护肝宝</span>
        <a href="/docs/">文档</a><a href={`${repoUrl}/releases/latest`}>下载</a><Link to={paths.login}>控制台</Link><a href={repoUrl}>GitHub</a><a href={`${repoUrl}/issues`}>反馈问题</a><Link to={paths.privacy}>隐私政策</Link><Link to={paths.terms}>服务条款</Link>
      </div>
    </footer>
  );
}
