"""video-tts — 内置音色目录与 provider 工厂。

三组目录与设计文档一致：

- `LOCAL_VOICES`：本地 MLX Qwen3-TTS CustomVoice 的 9 个音色（spec §5.1）；
- `ONLINE_FLAGSHIP_VOICES`：百炼 `qwen-audio-3.1-tts-plus` 的 4 个 v3.1
  旗舰音色，支持 `instruction`（spec §5.2.1）；
- `ONLINE_QWEN_TTS_VOICES`：百炼 `qwen3-tts-flash` 的 10 个精选普通话
  人格音色，5 女 / 5 男，不接受 `instruction`（spec §5.2.2）。

`find_voice` 在对应 provider 的目录里做 `voice_id` 精确匹配；`get_provider`
按名字实例化 provider，实现模块在函数内懒导入，因此 import 本包不会加载
mlx-audio 或要求 `bl` 可用。
"""

from __future__ import annotations

from .base import TTSProvider, Voice

LOCAL_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
LOCAL_DESIGN_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
FLAGSHIP_MODEL = "qwen-audio-3.1-tts-plus"
QWEN_TTS_MODEL = "qwen3-tts-flash"

# 模型 id 里出现这些标记即可判定模型族；大小写不敏感。
CUSTOM_VOICE_MARKER = "customvoice"
VOICE_DESIGN_MARKER = "voicedesign"


def is_voice_design_model(model_id: str | None) -> bool:
    """返回模型 id 是否属于 VoiceDesign 族。"""
    return bool(model_id) and VOICE_DESIGN_MARKER in model_id.lower()

LOCAL_VOICES: tuple[Voice, ...] = (
    Voice("Uncle_Fu", "Uncle_Fu", "男", "低沉醇厚的成熟男声", LOCAL_MODEL, "local"),
    Voice("Serena", "Serena", "女", "温暖、温柔的年轻女声", LOCAL_MODEL, "local"),
    Voice("Vivian", "Vivian", "女", "明亮、略带锋利感的年轻女声", LOCAL_MODEL, "local"),
    Voice("Dylan", "Dylan", "男", "年轻北京男声，清晰自然", LOCAL_MODEL, "local"),
    Voice("Eric", "Eric", "男", "活泼成都男声，略带沙哑亮度", LOCAL_MODEL, "local"),
    Voice("Ryan", "Ryan", "男", "节奏感强的男声", LOCAL_MODEL, "local"),
    Voice("Aiden", "Aiden", "男", "阳光美式男声，中频清晰", LOCAL_MODEL, "local"),
    Voice("Ono_Anna", "Ono_Anna", "女", "活泼轻盈的日语女声", LOCAL_MODEL, "local"),
    Voice("Sohee", "Sohee", "女", "温暖、情感丰富的韩语女声", LOCAL_MODEL, "local"),
)

ONLINE_FLAGSHIP_VOICES: tuple[Voice, ...] = (
    Voice("龙安灵心_v3.1", "longanlingxin_v3.1", "女", "知心、温柔", FLAGSHIP_MODEL, "online"),
    Voice("许南川_v3.1", "xunanchuan_v3.1", "男", "磁性、讲故事", FLAGSHIP_MODEL, "online"),
    Voice("龙安欢_v3.1", "longanhuan_v3.1", "女", "活泼、爱笑", FLAGSHIP_MODEL, "online"),
    Voice("龙安风悦_v3.1", "longanfengyue_v3.1", "女", "自然亲切、播报感", FLAGSHIP_MODEL, "online"),
)

ONLINE_QWEN_TTS_VOICES: tuple[Voice, ...] = (
    Voice("芊悦", "Cherry", "女", "阳光积极、亲切自然小姐姐", QWEN_TTS_MODEL, "online"),
    Voice("苏瑶", "Serena", "女", "温柔小姐姐", QWEN_TTS_MODEL, "online"),
    Voice("四月", "Maia", "女", "知性与温柔的碰撞", QWEN_TTS_MODEL, "online"),
    Voice("十三", "Vivian", "女", "拽拽的、可爱的小暴躁", QWEN_TTS_MODEL, "online"),
    Voice("茉兔", "Momo", "女", "撒娇搞怪，逗你开心", QWEN_TTS_MODEL, "online"),
    Voice(
        "晨煦", "Ethan", "男",
        "标准普通话，带部分北方口音；阳光、温暖、活力、朝气",
        QWEN_TTS_MODEL, "online",
    ),
    Voice("甜茶", "Ryan", "男", "节奏拉满，戏感炸裂，真实与张力共舞", QWEN_TTS_MODEL, "online"),
    Voice("月白", "Moon", "男", "率性帅气的月白", QWEN_TTS_MODEL, "online"),
    Voice("安德雷", "Andre", "男", "声音磁性，自然舒服、沉稳男生", QWEN_TTS_MODEL, "online"),
    Voice(
        "阿闻", "Neil", "男",
        "平直的基线语调，字正腔圆的咬字发音，最专业的新闻主持人",
        QWEN_TTS_MODEL, "online",
    ),
)

_CATALOGS: dict[str, tuple[tuple[Voice, ...], ...]] = {
    "local": (LOCAL_VOICES,),
    "online": (ONLINE_FLAGSHIP_VOICES, ONLINE_QWEN_TTS_VOICES),
}


def find_voice(provider: str, voice_id: str) -> Voice:
    """按 provider 和 `voice_id` 精确查找音色；找不到时列出全部合法 ID。"""
    catalogs = _CATALOGS.get(provider)
    if catalogs is None:
        valid = ", ".join(_CATALOGS)
        raise ValueError(f"unknown provider {provider!r}; expected one of: {valid}")

    voices = [voice for catalog in catalogs for voice in catalog]
    for voice in voices:
        if voice.voice_id == voice_id:
            return voice

    valid_ids = ", ".join(voice.voice_id for voice in voices)
    raise ValueError(
        f"unknown voice {voice_id!r} for provider {provider!r}; "
        f"valid IDs: {valid_ids}"
    )


def get_provider(name: str, **kwargs) -> TTSProvider:
    """按名字实例化 provider（实现模块懒导入）。"""
    if name == "local":
        from .local_mlx import LocalMLXProvider

        return LocalMLXProvider(**kwargs)
    if name == "online":
        from .online_bailian import OnlineBailianProvider

        return OnlineBailianProvider(**kwargs)
    valid = ", ".join(_CATALOGS)
    raise ValueError(f"unknown provider {name!r}; expected one of: {valid}")
