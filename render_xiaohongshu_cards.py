import os, base64
from playwright.sync_api import sync_playwright

output_dir = r'd:\Project\BossSpider\new\image\xiaohongshu_cards'
os.makedirs(output_dir, exist_ok=True)

def to_base64(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode('utf-8')

dash_img = to_base64(r'd:\Project\BossSpider\new\image\Dashboard.png')
job_img = to_base64(r'd:\Project\BossSpider\new\image\Job Board.png')
power_img = to_base64(r'd:\Project\BossSpider\new\image\power.png')
cust_res_img = to_base64(r'd:\Project\BossSpider\new\image\Customized Resume.png')
interview_img = to_base64(r'd:\Project\BossSpider\new\image\Interview.png')

common_style = '''
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        width: 1080px;
        height: 1440px;
        background: #07090e;
        color: #f1f5f9;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 56px 60px;
        position: relative;
        overflow: hidden;
    }
    
    /* Radial ambient glows */
    .bg-glow-top {
        position: absolute;
        top: -150px;
        left: 50%;
        transform: translateX(-50%);
        width: 850px;
        height: 550px;
        background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, rgba(129, 140, 248, 0.12) 40%, transparent 70%);
        pointer-events: none;
    }
    .bg-glow-bottom {
        position: absolute;
        bottom: -200px;
        right: -100px;
        width: 750px;
        height: 550px;
        background: radial-gradient(circle, rgba(168, 85, 247, 0.18) 0%, rgba(56, 189, 248, 0.1) 50%, transparent 70%);
        pointer-events: none;
    }
    .grid-pattern {
        position: absolute;
        inset: 0;
        background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
        background-size: 40px 40px;
        pointer-events: none;
    }

    /* Top bar */
    .header-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: 10;
    }
    .tag-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(56, 189, 248, 0.15);
        border: 1px solid rgba(56, 189, 248, 0.4);
        color: #38bdf8;
        padding: 10px 22px;
        border-radius: 100px;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.5px;
    }
    .page-number {
        font-size: 24px;
        font-weight: 800;
        color: #64748b;
        letter-spacing: 1px;
    }

    /* Content Area */
    .content-box {
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .main-title {
        font-size: 48px;
        font-weight: 900;
        line-height: 1.25;
        letter-spacing: -1px;
        color: #ffffff;
    }
    .gradient-text {
        background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    .subtitle {
        font-size: 22px;
        color: #94a3b8;
        line-height: 1.45;
        font-weight: 500;
    }

    /* Problem / Solution Boxes */
    .problem-box {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 18px;
        padding: 18px 24px;
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .problem-title {
        color: #fca5a5;
        font-size: 20px;
        font-weight: 700;
    }
    .solution-box {
        background: rgba(56, 189, 248, 0.1);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 18px;
        padding: 18px 24px;
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .solution-title {
        color: #38bdf8;
        font-size: 20px;
        font-weight: 700;
    }

    /* Screen Frame */
    .screen-frame {
        border-radius: 16px;
        overflow: hidden;
        border: 1.5px solid rgba(255, 255, 255, 0.18);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 35px rgba(56, 189, 248, 0.2);
        background: #0f172a;
        width: 100%;
    }
    .screen-frame img {
        width: 100%;
        height: auto;
        display: block;
    }

    /* Footer Bar */
    .footer-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 24px;
        z-index: 10;
    }
    .brand-logo {
        font-size: 26px;
        font-weight: 900;
        letter-spacing: -0.5px;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .brand-dot {
        width: 14px;
        height: 14px;
        background: #38bdf8;
        border-radius: 50%;
        box-shadow: 0 0 12px #38bdf8;
    }
    .footer-tip {
        font-size: 19px;
        color: #64748b;
        font-weight: 600;
    }
'''

cards_html = [
    # Card 1: Cover
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="bg-glow-bottom"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">🚀 个人独立开发 · 完全开源</div>
        <div class="page-number">01 / 06</div>
    </div>
    
    <div class="content-box">
        <div style="font-size: 26px; font-weight: 800; color: #38bdf8; letter-spacing: 2px; text-transform: uppercase;">BossFlow 本地求职工具</div>
        <div class="main-title" style="font-size: 52px;">
            我把 BOSS 直聘求职流程<br/>
            <span class="gradient-text">做成了桌面工具</span>
        </div>
        
        <div style="font-size: 22px; color: #cbd5e1; line-height: 1.5; margin-top: 4px;">
            最累的不是点“投递”，而是整理 JD、改简历与准备面试。<br/>一边求职，一边给自己写了个工具。
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 6px;">
            <div style="background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(56, 189, 248, 0.3); padding: 12px 18px; border-radius: 14px; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">🔍</span>
                <div>
                    <div style="font-size: 19px; font-weight: 800; color: #ffffff;">岗位筛选采集</div>
                    <div style="font-size: 15px; color: #94a3b8;">排除关键词与多维排序</div>
                </div>
            </div>
            <div style="background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(168, 85, 247, 0.3); padding: 12px 18px; border-radius: 14px; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">📊</span>
                <div>
                    <div style="font-size: 19px; font-weight: 800; color: #ffffff;">能力档案统计</div>
                    <div style="font-size: 15px; color: #94a3b8;">拆解分析先补什么</div>
                </div>
            </div>
            <div style="background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(129, 140, 248, 0.3); padding: 12px 18px; border-radius: 14px; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">📄</span>
                <div>
                    <div style="font-size: 19px; font-weight: 800; color: #ffffff;">针对性改简历</div>
                    <div style="font-size: 15px; color: #94a3b8;">手动确认绝不乱写</div>
                </div>
            </div>
            <div style="background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(52, 211, 153, 0.3); padding: 12px 18px; border-radius: 14px; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">🗣️</span>
                <div>
                    <div style="font-size: 19px; font-weight: 800; color: #ffffff;">面试与招呼文案</div>
                    <div style="font-size: 15px; color: #94a3b8;">考点拆解与定制沟通</div>
                </div>
            </div>
        </div>
    </div>

    <div style="z-index: 10; max-height: 600px; overflow: hidden; border-radius: 16px;">
        <div class="screen-frame">
            <img src="{dash_img}" />
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow</div>
        <div class="footer-tip">GitHub 开源项目: chenyu152/BossFlow</div>
    </div>
    </body></html>''',

    # Card 2: Feature 1 - Job Filter & Crawler (Single HD screenshot)
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">🔍 功能一：岗位筛选与采集</div>
        <div class="page-number">02 / 06</div>
    </div>
    
    <div class="content-box">
        <div class="main-title" style="font-size: 44px;">
            岗位筛选采集：<span class="gradient-text">判断值不值得投</span>
        </div>

        <div class="problem-box">
            <span style="font-size: 32px;">❌</span>
            <div>
                <div class="problem-title">求职痛点：切页面整理 JD，岗位多容易乱</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">最累的是反复打开岗位、手动整理 JD 信息，繁琐又低效。</div>
            </div>
        </div>

        <div class="solution-box">
            <span style="font-size: 32px;">✅</span>
            <div>
                <div class="solution-title">BossFlow：批量采集与多维度筛选排序</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">按照求职目标、排除关键词、薪资、经验和技能过滤，清晰掌控岗位动态。</div>
            </div>
        </div>
    </div>

    <div style="z-index: 10; max-height: 600px; overflow: hidden; border-radius: 16px;">
        <div class="screen-frame">
            <img src="{job_img}" />
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow</div>
        <div class="footer-tip">高清岗位库列表 · 批量多维过滤</div>
    </div>
    </body></html>''',

    # Card 3: Feature 2 - Capability Profile
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">📊 功能二：能力档案统计</div>
        <div class="page-number">03 / 06</div>
    </div>
    
    <div class="content-box">
        <div class="main-title" style="font-size: 44px;">
            能力档案统计：<span class="gradient-text">决定先补什么技能</span>
        </div>

        <div class="problem-box">
            <span style="font-size: 32px;">❌</span>
            <div>
                <div class="problem-title">求职痛点：盲目复习，不知道该先学什么</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">不知道目标岗位普遍看重哪项技能，容易在次要技能上浪费时间。</div>
            </div>
        </div>

        <div class="solution-box">
            <span style="font-size: 32px;">✅</span>
            <div>
                <div class="solution-title">BossFlow：拆解 JD 统计技能出现频次</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">把 AI 精评的候选岗位拆成能力项，直观统计哪些技能被多个岗位反复提到。</div>
            </div>
        </div>
    </div>

    <div style="z-index: 10; max-height: 600px; overflow: hidden; border-radius: 16px;">
        <div class="screen-frame">
            <img src="{power_img}" />
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow</div>
        <div class="footer-tip">明确提升方向 · 拒绝盲目补课</div>
    </div>
    </body></html>''',

    # Card 4: Feature 3 - Customized Resume (Single HD screenshot)
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">📄 功能三：针对性简历修改</div>
        <div class="page-number">04 / 06</div>
    </div>
    
    <div class="content-box">
        <div class="main-title" style="font-size: 42px;">
            针对性简历修改：<span class="gradient-text">人工确认，绝不瞎编</span>
        </div>

        <div class="problem-box">
            <span style="font-size: 32px;">❌</span>
            <div>
                <div class="problem-title">求职痛点：通用简历效果差，直接写 AI 假经历</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">通用简历没有针对性，全自动 AI 改简历又容易把假的虚构内容写入。</div>
            </div>
        </div>

        <div class="solution-box">
            <span style="font-size: 32px;">✅</span>
            <div>
                <div class="solution-title">BossFlow：对照 JD 给出建议，需手动确认</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">对照 JD 与个人简历输出优化方向，改动必须经过你自己勾选确认后生效。</div>
            </div>
        </div>
    </div>

    <div style="z-index: 10; max-height: 600px; overflow: hidden; border-radius: 16px;">
        <div class="screen-frame">
            <img src="{cust_res_img}" />
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow</div>
        <div class="footer-tip">高清定制简历与建议面板 · 真实保真</div>
    </div>
    </body></html>''',

    # Card 5: Feature 4 - Interview Prep & Custom Greeting
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">🗣️ 功能四：面试准备与招呼文案</div>
        <div class="page-number">05 / 06</div>
    </div>
    
    <div class="content-box">
        <div class="main-title" style="font-size: 42px;">
            面试与招呼文案：<span class="gradient-text">准备考点与沟通线索</span>
        </div>

        <div class="problem-box">
            <span style="font-size: 32px;">❌</span>
            <div>
                <div class="problem-title">求职痛点：招呼语千篇一律 & 面试被问住</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">系统默认打招呼语很难吸引注意力，面试遇到高频考点缺乏清晰回答线索。</div>
            </div>
        </div>

        <div class="solution-box">
            <span style="font-size: 32px;">✅</span>
            <div>
                <div class="solution-title">BossFlow：准备面试考点 & 输出招呼话术</div>
                <div style="font-size: 17px; color: #cbd5e1; margin-top: 2px;">按岗位准备面试考点线索；沟通话术填进输入框，由你决定是否发送。</div>
            </div>
        </div>
    </div>

    <div style="z-index: 10; max-height: 580px; overflow: hidden; border-radius: 16px;">
        <div class="screen-frame">
            <img src="{interview_img}" />
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow</div>
        <div class="footer-tip">充足准备 · 自主控制沟通节奏</div>
    </div>
    </body></html>''',

    # Card 6: Quickstart & Open Source
    f'''<!DOCTYPE html><html><head><style>{common_style}</style></head><body>
    <div class="bg-glow-top"></div>
    <div class="bg-glow-bottom"></div>
    <div class="grid-pattern"></div>
    
    <div class="header-bar">
        <div class="tag-badge">💻 开箱即用 · 完全开源</div>
        <div class="page-number">06 / 06</div>
    </div>
    
    <div class="content-box">
        <div class="main-title" style="font-size: 46px;">
            Windows 客户端免配置 · <span class="gradient-text">下载即用</span>
        </div>
        <div class="subtitle" style="font-size: 22px;">
            代码在 GitHub 完全开源，持续迭代中，欢迎体验与真实反馈！
        </div>
    </div>

    <div style="z-index: 10;" class="glass-card">
        <div style="display: flex; flex-direction: column; gap: 24px;">
            <div style="display: flex; align-items: center; gap: 20px;">
                <div style="font-size: 40px; background: rgba(56, 189, 248, 0.15); width: 80px; height: 80px; border-radius: 20px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(56, 189, 248, 0.3);">💻</div>
                <div>
                    <div style="font-size: 26px; font-weight: 800; color: #ffffff;">Windows 安装包双击即用</div>
                    <div style="font-size: 20px; color: #94a3b8; margin-top: 4px;">不需要配置 Python、Node.js，去 GitHub Releases 下载即可。</div>
                </div>
            </div>
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 20px; display: flex; align-items: center; gap: 20px;">
                <div style="font-size: 40px; background: rgba(168, 85, 247, 0.15); width: 80px; height: 80px; border-radius: 20px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(168, 85, 247, 0.3);">🔒</div>
                <div>
                    <div style="font-size: 26px; font-weight: 800; color: #ffffff;">核心数据默认保存在本机</div>
                    <div style="font-size: 20px; color: #94a3b8; margin-top: 4px;">岗位库、简历与 Cookie 保留在本地；AI 功能可自行配置 API Key。</div>
                </div>
            </div>
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 20px; display: flex; align-items: center; gap: 20px;">
                <div style="font-size: 40px; background: rgba(129, 140, 248, 0.15); width: 80px; height: 80px; border-radius: 20px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(129, 140, 248, 0.3);">⭐</div>
                <div>
                    <div style="font-size: 26px; font-weight: 800; color: #ffffff;">GitHub 开源地址</div>
                    <div style="font-size: 22px; font-weight: 700; color: #38bdf8; margin-top: 4px;">github.com/chenyu152/BossFlow</div>
                </div>
            </div>
        </div>
    </div>

    <div class="footer-bar">
        <div class="brand-logo"><div class="brand-dot"></div>BossFlow - 个人求职效率提升工具</div>
        <div class="footer-tip">欢迎使用与提出真实建议 😂</div>
    </div>
    </body></html>'''
]

print('Rendering 6 Xiaohongshu 3:4 cards with single HD screenshots on Card 2 & 4...')
with sync_playwright() as p:
    browser = p.chromium.launch()
    for idx, html in enumerate(cards_html, 1):
        page = browser.new_page(viewport={'width': 1080, 'height': 1440})
        page.set_content(html)
        out_file = os.path.join(output_dir, f'xiaohongshu_card_{idx}.png')
        page.screenshot(path=out_file)
        print(f'Rendered card {idx}: {out_file}')
    browser.close()

print('All 6 Xiaohongshu 3:4 cards rendered successfully!')
