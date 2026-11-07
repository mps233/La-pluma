package notifications

type botCommand struct {
	command     string
	description string
}

var botCommands = []botCommand{
	{command: "help", description: "显示帮助信息"},
	{command: "status", description: "查看当前任务状态"},
	{command: "screenshot", description: "截取当前屏幕"},
	{command: "startup", description: "启动游戏 (例: /startup Official)"},
	{command: "closedown", description: "关闭游戏"},
	{command: "fight", description: "执行理智作战 (例: /fight 1-7)"},
	{command: "roguelike", description: "执行肉鸽任务 (例: /roguelike Sami)"},
	{command: "run", description: "运行任务流程 (例: /run automation)"},
	{command: "stop", description: "停止当前任务"},
}

func helpMessage() string {
	return `🤖 La Pluma Bot 命令列表

📋 基础命令：
/help 或 帮助 - 显示此帮助信息
/status 或 状态 - 查看当前任务状态
/screenshot 或 截图 - 截取当前屏幕

🎮 游戏控制：
/startup 客户端 或 启动/开启/打开 客户端 - 启动游戏
  客户端：Official, Bilibili（默认 Official）
  例如：打开 Official 或 /startup Official

/closedown 客户端 或 关闭 客户端 - 关闭游戏
  例如：关闭 Official 或 /closedown Official

⚔️ 任务命令：
/fight 关卡 或 刷 关卡 - 执行理智作战
  例如：刷 1-7 或 /fight 1-7

/copilot URI - 执行抄作业（自动导航）
  例如：/copilot prts://12345
  或直接发送：prts://12345
  ✨ 会自动导航到关卡界面

/roguelike 主题 或 肉鸽 主题 - 执行肉鸽任务
  主题：Sami, Sarkaz, Mizuki, Phantom
  例如：肉鸽 Sami 或 /roguelike Sami

⏹️ 控制命令：
/stop 或 停止 - 停止当前任务

🔄 任务流程：
/run 流程类型 或 运行 流程类型 - 运行任务流程
  流程类型：automation（日常）, combat（作战）, roguelike（肉鸽）
  例如：运行 automation 或 /run automation
  不指定类型默认运行日常流程

💡 提示：
- 所有命令都支持中文关键词，更方便输入
- 执行任务前需要先"启动"游戏
- 任务完成后建议"关闭"游戏
- 可以直接发送 prts://12345 快速抄作业
- 可以直接发送"截图"快速截图
- 任务执行完成后会自动发送通知

📝 中文命令示例：
• 截图
• 状态
• 打开 Official
• 刷 1-7
• 肉鸽 Sami
• 运行 automation（或直接发送"日常"）
• 停止
• 关闭`
}
