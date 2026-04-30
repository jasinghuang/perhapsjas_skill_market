#!/usr/bin/env python3
"""
LLM Refine Module
Text refinement and translation using LLM
"""

import json
import re
import sys
from pathlib import Path
from typing import List, Optional, Dict

# Config file path
CONFIG_FILE = Path(__file__).parent / "config.json"


def load_config() -> dict:
    """Load configuration from config.json"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        "model": "qwen3.5-plus",
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "temperature": 0.3,
        "max_tokens": 4000,
        "batch_max_tokens": 8000,
        "batch_size": 45,
        "translate": False,
        "parallel_batches": 3
    }


def get_llm_client():
    """Get LLM client from config"""
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("请安装 openai: pip install openai")

    config = load_config()
    return OpenAI(
        api_key=config.get('api_key'),
        base_url=config.get('base_url', 'https://api.openai.com/v1')
    ), config.get('model', 'gpt-4o')


# ============================================================================
# 视频类型检测（用于提示词选择）
# ============================================================================

VIDEO_TYPE_KEYWORDS = {
    "medical": [
        "膈肌", "骨盆", "体态", "康复", "肋骨外翻", "腹内压", "脊柱",
        "髋关节", "膝关节", "肩胛", "颈椎", "腰椎", "肌肉", "筋膜",
        "呼吸训练", "核心", "盆底肌", "骶骨", "胸椎"
    ],
    "tech": [
        "代码", "编程", "API", "Cursor", "Python", "JavaScript", "React",
        "算法", "数据库", "服务器", "部署", "Docker", "Kubernetes",
        "Git", "GitHub", "调试", "框架", "后端", "前端", "AI", "机器学习",
        "Google Flights", "Notion", "浏览器", "插件", "自动化"
    ],
    "finance": [
        "股票", "基金", "投资", "理财", "财经", "证券", "期货",
        "K线", "技术分析", "基本面", "财报", "估值", "收益"
    ]
}


def detect_video_type(segments: list, sample_size: int = 30) -> str:
    """根据字幕内容检测视频类型"""
    if not segments:
        return "general"

    # 取前 sample_size 个段落的文本
    sample_texts = []
    for seg in segments[:sample_size]:
        if isinstance(seg, dict) and 'text' in seg:
            sample_texts.append(seg['text'])
        elif isinstance(seg, str):
            sample_texts.append(seg)

    combined_text = " ".join(sample_texts)

    # 计算各类型关键词匹配数
    scores = {}
    for video_type, keywords in VIDEO_TYPE_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in combined_text)
        scores[video_type] = score

    # 返回得分最高的类型
    max_score = max(scores.values())
    if max_score > 0:
        for video_type, score in scores.items():
            if score == max_score:
                return video_type

    return "general"


def get_video_type_description(video_type: str) -> str:
    """获取视频类型的中文描述"""
    descriptions = {
        "medical": "运动康复/医疗健康",
        "tech": "科技编程",
        "finance": "财经投资",
        "general": "通用"
    }
    return descriptions.get(video_type, "通用")


# ============================================================================
# 全文主题提取
# ============================================================================

def extract_context(all_texts: List[str], sample_size: int = 50) -> str:
    """提取全文主题和关键术语，用于后续校准的上下文"""
    client, model = get_llm_client()
    config = load_config()

    # 取样本（前、中、后各取一部分）
    total = len(all_texts)
    if total <= sample_size:
        sample = all_texts
    else:
        # 取前1/3、中1/3、后1/3各取一部分
        third = total // 3
        sample = (
            all_texts[:sample_size//3] +
            all_texts[third:third+sample_size//3] +
            all_texts[-sample_size//3:]
        )

    sample_text = "\n".join([f"{i+1}. {t}" for i, t in enumerate(sample)])

    prompt = """分析以下字幕文本片段，提取：

1. **主题**：这段内容主要讲什么？（一句话概括）
2. **关键术语**：出现的专业术语、产品名称、人名、地名等（列出5-10个最重要的）
3. **语境提示**：后续校准时需要注意的事项（如：这是技术教程，产品名称要准确；这是医疗内容，解剖学术语要准确等）

请简洁输出，格式如下：
主题：xxx
关键术语：xxx, xxx, xxx
校准提示：xxx"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": f"{prompt}\n\n{sample_text}"}
            ],
            temperature=0.1,
            max_tokens=500
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"   ⚠️  Context extraction failed: {e}")
        return ""


# ============================================================================
# 提示词系统
# ============================================================================

PROMPTS = {
    "general": {
        "system": """你是一个专业的内容校对编辑。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。同音字的选择、术语的确定都要基于上下文语境。

**特别重要 - 删除Whisper冗余词**：
Whisper经常误添加无意义的"叫做"、"所谓的"等词，必须删除：
- "叫做被抑制" → "被抑制"
- "所谓叫做这个功能" → "这个功能"
- **原则**：删除"叫做"后，如果句子仍然通顺，就不要加回任何词

**常见ASR识别错误纠正**：
根据上下文语义判断同音字错误：
- "Google fly" → "Google Flights"（谷歌航班）
- "Crawl" → "Cursor"（AI编程工具）
- "肃部" → "腹部"
- "隔肌" → "膈肌"
- "肋股" → "肋骨"
- 技术产品名称要准确（Cursor、Notion、Google等）

请按以下步骤处理：
1. **理解语境**：结合全文主题理解当前句子的含义
2. **删除冗余**：删除"叫做"、"所谓的"等Whisper误添加的词
3. **校准**：根据上下文语义修正错别字、同音字错误
4. **润色**：优化标点符号，确保文本通顺易读

注意：
- 不要改变原意（但删除冗余词不是改变原意）
- 不要添加内容
- 专有名词和产品名称必须准确
- 同音字的选择必须基于上下文语义
- 直接输出修正后的文本，不要解释""",

        "batch_system": """你是一个专业的内容校对编辑。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。同音字的选择、术语的确定都要基于上下文语境。

**全文主题**：
{context}

**常见ASR识别错误纠正**：
- "Google fly" → "Google Flights"
- "Crawl" → "Cursor"（AI编程工具）
- "肃部" → "腹部"
- "隔肌" → "膈肌"
- "肋股" → "肋骨"
- 技术产品名称要准确

**处理步骤**：
1. 理解全文主题和当前句子的语境
2. 删除"叫做"、"所谓的"等冗余词
3. 根据上下文语义修正错别字、同音字错误
4. 优化标点符号

**注意**：
- 不要改变原意
- 不要添加内容
- 同音字的选择必须基于上下文语义
- 输出格式：每行一个校准后的文本，用数字编号对应原文
- 不要解释，直接输出校准后的文本"""
    },

    "medical": {
        "system": """你是一个专业的内容校对编辑，专精于运动康复和体态矫正领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。同音字的选择、术语的确定都要基于上下文语境。

**特别重要 - 删除Whisper冗余词**：
Whisper经常误添加无意义的"叫做"、"所谓的"等词，必须删除：
- "叫做被抑制" → "被抑制"
- "所谓叫做圆肩驼背" → "圆肩驼背"
- **原则**：删除"叫做"后，如果句子仍然通顺，就不要加回任何词

**常见同音字错误纠正**：
ASR识别会出现大量同音字错误，必须根据上下文语义判断：
- "肃内压" → "腹内压"（医学专业术语）
- "肃部" → "腹部"
- "肃肌" → "腹肌"
- "隔肌" → "膈肌"（解剖学术语，不是"隔离"的"隔"）
- "肋股" → "肋骨"
- "胸肃角" → "胸骨角"
- "抵骨" → "骶骨"或"髋骨"（根据上下文）
- "吐出来" → "凸出来"（体态描述）
- "前倾" vs "前屈"（动作描述）
- "内囊寒胸" → "内扣含胸"

**语义理解原则**：
- "膈肌下沉卡在吸气状态"不应被改为"膈肌下沉卡在呼吸状态"
- "肋骨外翻"不能改为"肋骨外翻出来"（增加语义）
- "胸骨角窄"不能改为"胸骨角狭窄的"（形容词不当）
- 医学术语和专有名词要准确，不能随意更改

请按以下步骤处理：
1. **理解语境**：结合全文主题理解当前句子的含义
2. **删除冗余**：删除"叫做"、"所谓的"等Whisper误添加的词
3. **校准**：根据上下文语义修正错别字、同音字错误
4. **润色**：优化标点符号，确保文本通顺易读

注意：
- 不要改变原意（但删除冗余词不是改变原意）
- 不要添加内容
- 医学术语、解剖学术语必须准确
- 同音字的选择必须基于上下文语义
- 直接输出修正后的文本，不要解释""",

        "batch_system": """你是一个专业的内容校对编辑，专精于运动康复和体态矫正领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。同音字的选择、术语的确定都要基于上下文语境。

**全文主题**：
{context}

**常见同音字错误纠正**：
- "肃内压" → "腹内压"
- "肃部" → "腹部"
- "肃肌" → "腹肌"
- "隔肌" → "膈肌"
- "肋股" → "肋骨"
- "胸肃角" → "胸骨角"
- "抵骨" → "骶骨"或"髋骨"
- "吐出来" → "凸出来"

**处理步骤**：
1. 理解全文主题和当前句子的语境
2. 删除"叫做"、"所谓的"等冗余词
3. 根据上下文语义修正错别字、同音字错误
4. 优化标点符号

**注意**：
- 不要改变原意
- 医学术语必须准确
- 同音字的选择必须基于上下文语义
- 输出格式：每行一个校准后的文本，用数字编号对应原文
- 不要解释，直接输出校准后的文本"""
    },

    "tech": {
        "system": """你是一个专业的内容校对编辑，专精于科技、编程和AI领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。技术产品名称、术语的确定都要基于上下文语境。

**特别重要 - 删除Whisper冗余词**：
Whisper经常误添加无意义的"叫做"、"所谓的"等词，必须删除：
- "叫做Cursor" → "Cursor"
- "所谓叫做这个功能" → "这个功能"
- **原则**：删除"叫做"后，如果句子仍然通顺，就不要加回任何词

**科技产品名称纠正**：
ASR经常识别错误技术产品名称：
- "Crawl" → "Cursor"（AI编程工具）
- "Google fly" → "Google Flights"（谷歌航班）
- "Google flight" → "Google Flights"
- "Notion API" 保持不变
- "API" 读作 "A-P-I" 不是 "阿皮"
- "Chrome" 不是 "铬" 或 "google浏览器"
- "Claude" 不是 "克劳德"（AI助手）
- "ChatGPT" 不是 "chat GPT"
- "GitHub" 不是 "github" 或 "吉特哈布"

**常见技术术语错误**：
- "地域" → "阈值"（设置阈值）
- "回调" → "回调函数"
- "接口" 保持不变
- "类" → "类" 或 "类别" 根据上下文

请按以下步骤处理：
1. **理解语境**：结合全文主题理解当前句子的含义
2. **删除冗余**：删除"叫做"、"所谓的"等Whisper误添加的词
3. **校准**：根据上下文语义修正错别字、产品名称错误
4. **润色**：优化标点符号，确保文本通顺易读

注意：
- 不要改变原意（但删除冗余词不是改变原意）
- 不要添加内容
- 技术产品名称必须准确
- 同音字的选择必须基于上下文语义
- 直接输出修正后的文本，不要解释""",

        "batch_system": """你是一个专业的内容校对编辑，专精于科技、编程和AI领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。技术产品名称、术语的确定都要基于上下文语境。

**全文主题**：
{context}

**科技产品名称纠正**：
- "Crawl" → "Cursor"（AI编程工具）
- "Google fly" → "Google Flights"
- "地域" → "阈值"（设置阈值）

**处理步骤**：
1. 理解全文主题和当前句子的语境
2. 删除"叫做"、"所谓的"等冗余词
3. 根据上下文语义修正错别字、产品名称错误
4. 优化标点符号

**注意**：
- 不要改变原意
- 技术产品名称必须准确
- 同音字的选择必须基于上下文语义
- 输出格式：每行一个校准后的文本，用数字编号对应原文
- 不要解释，直接输出校准后的文本"""
    },

    "finance": {
        "system": """你是一个专业的内容校对编辑，专精于财经投资领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。财经术语、公司名称的确定都要基于上下文语境。

**特别重要 - 删除Whisper冗余词**：
Whisper经常误添加无意义的"叫做"、"所谓的"等词，必须删除。

**财经术语纠正**：
- "K线" 保持不变
- "涨停板" 不是 "涨停版"
- "跌停板" 不是 "跌停版"
- "市盈率" 不是 "市盈绿"
- "收益率" 不是 "收利益"
- 股票代码和公司名称要准确

请按以下步骤处理：
1. **理解语境**：结合全文主题理解当前句子的含义
2. **删除冗余**：删除"叫做"、"所谓的"等Whisper误添加的词
3. **校准**：根据上下文语义修正错别字、专业术语错误
4. **润色**：优化标点符号，确保文本通顺易读

注意：
- 不要改变原意
- 财经术语必须准确
- 同音字的选择必须基于上下文语义
- 直接输出修正后的文本，不要解释""",

        "batch_system": """你是一个专业的内容校对编辑，专精于财经投资领域。你的任务是校对ASR语音识别生成的中文文本。

**核心原则：基于全文主题和语义校准**
你必须结合全文主题来理解每个句子的含义，而不是孤立地校对每个句子。财经术语、公司名称的确定都要基于上下文语境。

**全文主题**：
{context}

**财经术语纠正**：
- 股票代码和公司名称要准确
- "涨停板" 不是 "涨停版"
- "市盈率" 不是 "市盈绿"

**处理步骤**：
1. 理解全文主题和当前句子的语境
2. 删除冗余词
3. 根据上下文语义修正错别字、专业术语
4. 优化标点符号

**注意**：
- 不要改变原意
- 同音字的选择必须基于上下文语义
- 输出格式：每行一个校准后的文本，用数字编号对应原文
- 不要解释，直接输出校准后的文本"""
    }
}


# ============================================================================
# 翻译
# ============================================================================

TRANSLATE_PROMPT = """你是一个专业的翻译专家。请将以下文本翻译成中文。

要求：
1. 准确传达原文意思
2. 使用地道的中文表达
3. 保持原文的风格和语气
4. 专有名词保持原样或使用通用中文译名

直接输出翻译后的中文文本，不要解释。"""


def translate_text(text: str, source_lang: str = "auto") -> str:
    """将文本翻译成中文"""
    client, model = get_llm_client()
    config = load_config()

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TRANSLATE_PROMPT},
                {"role": "user", "content": text}
            ],
            temperature=config.get('temperature', 0.3),
            max_tokens=config.get('max_tokens', 4000)
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"   ⚠️  Translation failed: {e}")
        return text


def translate_batch(texts: List[str]) -> List[str]:
    """批量翻译文本"""
    client, model = get_llm_client()
    config = load_config()

    numbered_texts = "\n".join([f"{i+1}. {text}" for i, text in enumerate(texts)])

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": TRANSLATE_PROMPT},
                {"role": "user", "content": f"请翻译以下文本，保持编号对应：\n\n{numbered_texts}"}
            ],
            temperature=config.get('temperature', 0.3),
            max_tokens=config.get('batch_max_tokens', 4000)
        )

        result = response.choices[0].message.content.strip()
        translated = []
        for line in result.split('\n'):
            line = line.strip()
            if not line:
                continue
            match = re.match(r'^\d+[\.\、]\s*(.+)$', line)
            if match:
                translated.append(match.group(1))
            elif line and not line[0].isdigit():
                translated.append(line)

        while len(translated) < len(texts):
            translated.append(texts[len(translated)])

        return translated[:len(texts)]
    except Exception as e:
        print(f"   ⚠️  Batch translation failed: {e}")
        return texts


# ============================================================================
# 校准
# ============================================================================

def refine_text(text: str, video_type: str = "general") -> str:
    """校准单段文本"""
    client, model = get_llm_client()
    config = load_config()
    prompts = PROMPTS.get(video_type, PROMPTS["general"])

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompts["system"]},
                {"role": "user", "content": f"请校对以下文本：\n\n{text}"}
            ],
            temperature=config.get('temperature', 0.3),
            max_tokens=config.get('max_tokens', 4000)
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"   ⚠️  Refinement failed: {e}")
        return text


def refine_batch(texts: List[str], video_type: str = "general", context: str = "") -> List[str]:
    """批量校准文本

    Args:
        texts: 待校准的文本列表
        video_type: 视频类型 (general/medical/tech/finance)
        context: 全文主题上下文（由 extract_context 函数生成）
    """
    client, model = get_llm_client()
    config = load_config()
    prompts = PROMPTS.get(video_type, PROMPTS["general"])

    # 检测视频类型
    if video_type == "general":
        detected_type = detect_video_type([{"text": t} for t in texts])
        if detected_type != "general":
            print(f"   🔍 检测到视频类型: {get_video_type_description(detected_type)}")
            prompts = PROMPTS.get(detected_type, PROMPTS["general"])

    numbered_texts = "\n".join([f"{i+1}. {text}" for i, text in enumerate(texts)])

    # 将上下文注入提示词
    system_prompt = prompts["batch_system"].format(context=context if context else "（未提供）")

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"请校对以下文本，保持编号对应：\n\n{numbered_texts}\n\n请直接输出校准后的文本，每行一个，用编号开头："}
            ],
            temperature=config.get('temperature', 0.3),
            max_tokens=config.get('batch_max_tokens', 4000)
        )

        result = response.choices[0].message.content.strip()
        refined = []
        for line in result.split('\n'):
            line = line.strip()
            if not line:
                continue
            match = re.match(r'^\d+[\.\、]\s*(.+)$', line)
            if match:
                refined.append(match.group(1))
            elif line and not line[0].isdigit():
                refined.append(line)

        while len(refined) < len(texts):
            refined.append(texts[len(refined)])

        return refined[:len(texts)]
    except Exception as e:
        print(f"   ⚠️  Batch refinement failed: {e}")
        return texts


# ============================================================================
# 语言检测
# ============================================================================

def detect_language(text: str) -> str:
    """检测文本语言"""
    # 简单的语言检测：统计中日韩字符比例
    cjk_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    total_count = len(text.strip())

    if total_count == 0:
        return "unknown"

    cjk_ratio = cjk_count / total_count

    if cjk_ratio > 0.3:
        return "zh"
    elif cjk_ratio > 0.1:
        # 可能是中日韩混合
        # 检查日文假名
        hiragana = sum(1 for c in text if '\u3040' <= c <= '\u309f')
        katakana = sum(1 for c in text if '\u30a0' <= c <= '\u30ff')
        if hiragana + katakana > 0:
            return "ja"
        # 检查韩文
        hangul = sum(1 for c in text if '\uac00' <= c <= '\ud7af')
        if hangul > 0:
            return "ko"
        return "zh"
    else:
        return "other"


# ============================================================================
# 主处理函数
# ============================================================================

def process_file(
    input_path: Path,
    output_path: Optional[Path] = None,
    refine: bool = True,
    translate: bool = False,
    batch_size: int = 20
) -> Path:
    """
    处理字幕文件

    Args:
        input_path: 输入文件路径
        output_path: 输出文件路径
        refine: 是否校准
        translate: 是否翻译（True=强制翻译，False=仅当检测为非中文时翻译）
        batch_size: 批处理大小

    Returns:
        输出文件路径
    """
    input_path = Path(input_path).expanduser()

    if not input_path.exists():
        raise FileNotFoundError(f"文件不存在: {input_path}")

    # 读取文件
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 解析文件格式
    segments = parse_file(content)

    if not segments:
        raise ValueError("无法从文件中提取文本内容")

    print(f"\n{'='*60}")
    print(f"📝 LLM Refine")
    print(f"{'='*60}")
    print(f"   📁 Input: {input_path}")
    print(f"   📊 Segments: {len(segments)}")

    # 检测语言
    all_text = " ".join([s['text'] if isinstance(s, dict) else s for s in segments])
    detected_lang = detect_language(all_text)
    print(f"   🌐 Detected language: {detected_lang}")

    # 确定处理流程
    # translate=True: 强制翻译所有文本
    # translate=False 且 detected_lang=='zh': 不翻译，只校准
    # translate=False 且 detected_lang!='zh': 自动翻译后校准
    if translate:
        print(f"   📋 Flow: 强制翻译 → 校准")
        need_translate = True
    elif detected_lang == "zh":
        print(f"   📋 Flow: 中文文本 → 校准")
        need_translate = False
    else:
        print(f"   📋 Flow: 非中文文本 → 翻译 → 校准")
        need_translate = True

    # 设置输出路径
    if output_path is None:
        output_path = input_path.parent / f"{input_path.stem}_refined.md"
    else:
        output_path = Path(output_path).expanduser()

    # 提取全文主题（用于校准时的上下文）
    all_texts = [s['text'] if isinstance(s, dict) else s for s in segments]
    print(f"   📖 Extracting context...")
    context = extract_context(all_texts)
    if context:
        print(f"   📋 Context: {context[:100]}..." if len(context) > 100 else f"   📋 Context: {context}")

    # 处理
    processed_segments = []

    # 批处理配置
    config = load_config()
    batch_size = batch_size or config.get('batch_size', 45)
    parallel_batches = config.get('parallel_batches', 3)
    total_batches = (len(segments) + batch_size - 1) // batch_size

    # 准备所有批次
    all_batches = []
    for i in range(0, len(segments), batch_size):
        batch = segments[i:i+batch_size]
        batch_texts = [s['text'] if isinstance(s, dict) else s for s in batch]
        all_batches.append((i, batch, batch_texts))

    # 并行处理函数
    def process_single_batch(batch_info):
        """处理单个批次"""
        idx, batch, batch_texts = batch_info
        batch_num = idx // batch_size + 1

        # 翻译（如果需要）
        if need_translate or translate:
            batch_texts = translate_batch(batch_texts)

        # 校准
        if refine:
            batch_texts = refine_batch(batch_texts, context=context)

        return (idx, batch, batch_texts)

    # 并行执行
    from concurrent.futures import ThreadPoolExecutor, as_completed

    print(f"   ⚡ Parallel processing with {parallel_batches} workers...")

    results = [None] * len(all_batches)  # 预分配结果列表

    with ThreadPoolExecutor(max_workers=parallel_batches) as executor:
        # 提交所有任务
        future_to_idx = {
            executor.submit(process_single_batch, batch_info): i
            for i, batch_info in enumerate(all_batches)
        }

        # 收集结果
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                result = future.result()
                results[idx] = result
                batch_num = result[0] // batch_size + 1
                print(f"   ✅ Batch {batch_num}/{total_batches} done")
            except Exception as e:
                print(f"   ⚠️  Batch failed: {e}")
                # 使用原始文本
                results[idx] = (all_batches[idx][0], all_batches[idx][1], all_batches[idx][2])

    # 按顺序合并结果
    for idx, batch, batch_texts in results:
        for j, (seg, text) in enumerate(zip(batch, batch_texts)):
            if isinstance(seg, dict):
                processed_segments.append({**seg, 'text': text})
            else:
                processed_segments.append({'text': text})

    # 生成输出
    model_name = config.get('model', 'unknown')
    generate_output(processed_segments, output_path, input_path.stem, context=context, model=model_name)

    print(f"\n{'='*60}")
    print(f"✅ Done! Output: {output_path}")
    print(f"{'='*60}\n")

    return output_path


def parse_file(content: str) -> List[Dict]:
    """解析文件内容，支持 SRT、MD、TXT 格式"""
    segments = []

    # 尝试解析 SRT 格式
    if '-->' in content:
        pattern = r'(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*\n(.*?)(?=\n\n|\Z)'
        matches = re.findall(pattern, content, re.DOTALL)
        if matches:
            for match in matches:
                segments.append({
                    'index': int(match[0]),
                    'start': match[1],
                    'end': match[2],
                    'text': match[3].strip()
                })
            return segments

    # 尝试解析 MD 格式（带时间戳）
    md_pattern = r'\*\*\[(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\]\*\*\s*\n(.*?)(?=\n---|\Z)'
    matches = re.findall(md_pattern, content, re.DOTALL)
    if matches:
        for match in matches:
            segments.append({
                'start': match[0],
                'end': match[1],
                'text': match[2].strip()
            })
        return segments

    # 跳过 Whisper 输出的元信息头部
    # 查找 "建议使用" 之后的内容开始解析
    if '建议使用' in content or '校准状态' in content:
        # 找到元信息结束位置
        lines = content.split('\n')
        start_idx = 0
        for i, line in enumerate(lines):
            if '建议使用' in line or ('---' in line and i > 10):
                start_idx = i + 1
                break
        # 跳过开头的空行和分隔符
        while start_idx < len(lines) and (lines[start_idx].strip() == '' or lines[start_idx].strip() == '---'):
            start_idx += 1
        content = '\n'.join(lines[start_idx:])

    # 按行解析（TXT 格式），跳过空行和分隔符
    lines = content.strip().split('\n')
    for i, line in enumerate(lines):
        line = line.strip()
        # 跳过空行、分隔符、标题行
        if line and line != '---' and not line.startswith('#'):
            segments.append({'text': line})

    return segments


def generate_output(segments: List[Dict], output_path: Path, title: str, context: str = "", model: str = ""):
    """生成输出文件"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    from datetime import datetime

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f"# {title}\n\n")
        f.write(f"**Refined by**: LLM ({model})\n")
        f.write(f"**Refined at**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Segments**: {len(segments)}\n")
        if context:
            # 只显示主题部分
            context_summary = context.split('\n')[0] if '\n' in context else context[:100]
            f.write(f"**Context**: {context_summary}\n")
        f.write(f"\n**校准状态**: ✅ 已通过 LLM 校准\n\n")

        for seg in segments:
            if 'start' in seg and 'end' in seg:
                f.write(f"**[{seg['start']} - {seg['end']}]**\n")
            f.write(f"{seg['text']}\n\n")


# ============================================================================
# 命令行入口
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description='LLM-based text refinement and translation',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py input.srt
  python skill_main.py input.md --output refined.md
  python skill_main.py input.txt --refine --translate
  python skill_main.py input.srt --batch-size 30
        """
    )

    parser.add_argument('input', type=str, help='Input file (SRT, MD, TXT)')
    parser.add_argument('--output', '-o', type=str, help='Output file path')
    parser.add_argument('--refine', action='store_true', default=True,
                        help='Enable refinement (default: True)')
    parser.add_argument('--no-refine', action='store_true',
                        help='Disable refinement')
    parser.add_argument('--translate', '-t', action='store_true',
                        help='Force translation to Chinese')
    parser.add_argument('--no-translate', action='store_true',
                        help='Disable auto-translation (keep original language)')
    parser.add_argument('--batch-size', '-b', type=int, default=20,
                        help='Batch size for LLM calls (default: 20)')

    args = parser.parse_args()

    # Load config for defaults
    config = load_config()

    # 处理参数
    refine = args.refine and not args.no_refine

    # 翻译逻辑：命令行参数优先，其次配置文件
    # 如果检测到非中文，默认会翻译；--no-translate 禁用翻译，--translate 强制翻译
    if args.no_translate:
        force_translate = False
        auto_translate = False
    elif args.translate:
        force_translate = True
        auto_translate = True
    else:
        force_translate = False
        auto_translate = not config.get('translate', False)  # 配置默认 false = 自动检测翻译

    try:
        process_file(
            input_path=args.input,
            output_path=args.output,
            refine=refine,
            translate=force_translate,
            batch_size=args.batch_size
        )
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)