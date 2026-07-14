"""Resume JSON → cv.md Markdown 生成器."""

from .schema import Resume


def to_cv_markdown(resume: Resume) -> str:
    """将 Resume 对象渲染为 cv.md 格式的 Markdown 字符串。"""

    c = resume.candidate
    lines: list[str] = []

    # 标题
    name = c.name or "姓名"
    role = c.target_roles[0] if c.target_roles else "目标岗位"
    lines.append(f"# {name} - {role}")
    lines.append("")

    # 个人信息
    lines.append("## 个人信息")
    info_items = [
        ("姓名", c.name),
        ("手机", c.phone),
        ("邮箱", c.email),
        ("意向城市", " / ".join(c.target_cities)),
        ("目标岗位", " / ".join(c.target_roles)),
    ]
    if c.years_of_experience is not None:
        info_items.append(("工作经验", f"{c.years_of_experience} 年"))
    if c.highest_education:
        info_items.append(("最高学历", c.highest_education))

    for label, val in info_items:
        val = str(val).strip() if val else ""
        lines.append(f"- {label}：{val}")
    lines.append("")

    # 技能栈
    if any([resume.languages, resume.frameworks, resume.databases, resume.ai_llm, resume.tools, resume.skills]):
        lines.append("## 技能栈")
        _append_list(lines, "编程语言", resume.languages)
        _append_list(lines, "框架/平台", resume.frameworks)
        _append_list(lines, "数据库/中间件", resume.databases)
        _append_list(lines, "AI/大模型", resume.ai_llm)
        _append_list(lines, "工程工具", resume.tools)
        _append_list(lines, "其他技能", resume.skills)
        lines.append("")

    # 工作经历
    if resume.work_experience:
        lines.append("## 工作经历")
        lines.append("")
        for we in resume.work_experience:
            lines.append(f"### {we.company}")
            if we.position:
                lines.append(f"职位：{we.position}")
            if we.duration:
                lines.append(f"时间：{we.duration}")
            lines.append("")
            if we.responsibilities:
                for item in we.responsibilities:
                    lines.append(f"- 负责：{item}")
            if we.achievements:
                for item in we.achievements:
                    lines.append(f"- 主要成果：{item}")
            lines.append("")

    # 项目经历
    if resume.projects:
        lines.append("## 项目经历")
        lines.append("")
        for proj in resume.projects:
            lines.append(f"### {proj.name}")
            if proj.role:
                lines.append(f"角色：{proj.role}")
            if proj.duration:
                lines.append(f"时间：{proj.duration}")
            if proj.description:
                lines.append(f"项目简介：{proj.description}")
            lines.append("")
            if proj.highlights:
                for h in proj.highlights:
                    lines.append(f"- {h}")
            lines.append("")

    # 教育背景
    if resume.education:
        lines.append("## 教育背景")
        for edu in resume.education:
            parts = [edu.school, edu.degree, edu.major, edu.duration]
            line = " / ".join(p for p in parts if p)
            lines.append(f"- {line}")
        lines.append("")

    # 提取备注
    if resume.extraction_confidence:
        lines.append("---")
        lines.append(f"<!-- 提取置信度：{resume.extraction_confidence} -->")

    return "\n".join(lines).rstrip() + "\n"


def _append_list(lines: list[str], label: str, items: list[str]) -> None:
    if items:
        lines.append(f"- {label}：{'、'.join(items)}")
