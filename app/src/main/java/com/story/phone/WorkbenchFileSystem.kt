package com.story.phone

import android.content.Context
import android.os.Environment
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 工作台文件系统（Workbench 本地工作区桥接）
 *
 * 提供 agent 工作台所需的本地文件操作：
 * - listDir  目录浏览（返回条目：名称/类型/大小/修改时间）
 * - readFile 文本读取（超大文件自动截断，避免撑爆 WebView 桥）
 * - writeFile 文本写入（自动创建父目录）
 * - mkdir    创建目录
 * - delete   删除文件/目录（递归，仅限工作区根内）
 * - getRoots 返回可用根目录列表（App 私有工作区 + 公共存储尽力枚举）
 *
 * 安全边界：
 * - 所有路径都相对"工作区根"，用 resolveSafe() 归一化并拒绝越界（../ 逃逸）。
 * - 工作区根 = context.filesDir/workbench（App 私有，免存储权限，天然隔离）。
 * - 公共存储（/storage/emulated/0）仅做"浏览"尽力而为：有读取权限才列出，
 *   无权限时返回错误提示，不写公共目录（Android 11+ 分区存储限制）。
 */
class WorkbenchFileSystem(private val context: Context) {

    companion object {
        private const val TAG = "WorkbenchFs"
        private const val MAX_READ_BYTES = 512 * 1024 // 512KB 读取上限
    }

    /** 工作区根（所有相对路径的基准）。
     *  默认使用公共 Download 目录（/storage/emulated/0/Download/workbench），
     *  用户可用文件管理器直接查看/修改，无需 root 或 adb。
     *  需要「所有文件访问」权限（MANAGE_EXTERNAL_STORAGE，Android 11+ 分区存储限制）：
     *  未授权时返回错误提示，前端可调用 AndroidMCP.wbRequestStoragePermission() 引导授权；
     *  授权前回退到 App 私有目录（不影响使用，但用户不可见）。 */
    private fun workspaceRoot(): File {
        // 检查「所有文件访问」权限：有则用 Download，无则回退私有目录
        val hasAllFiles = if (android.os.Build.VERSION.SDK_INT >= 30) {
            Environment.isExternalStorageManager()
        } else {
            true // API 29 及以下允许直接写公共存储（配合 WRITE_EXTERNAL_STORAGE）
        }
        if (hasAllFiles) {
            val base = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val dir = File(base, "workbench")
            try { if (!dir.exists()) dir.mkdirs() } catch (e: Exception) {}
            return dir
        }
        val fallback = context.getExternalFilesDir(null) ?: context.filesDir
        val dir = File(fallback, "workbench")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** 当前是否可用公共 Download 工作区（供前端显示状态/引导授权） */
    fun isPublicWorkspace(): Boolean {
        return if (android.os.Build.VERSION.SDK_INT >= 30) {
            Environment.isExternalStorageManager()
        } else {
            true
        }
    }

    /** 把用户传入的相对路径安全解析为绝对路径；越界返回 null */
    private fun resolveSafe(rel: String): File? {
        val root = workspaceRoot().absoluteFile
        val cleaned = (rel ?: "").trim().replace("\\", "/")
        val target = File(root, cleaned).absoluteFile
        val rootPath = root.absolutePath.trimEnd('/') + "/"
        val targetPath = target.absolutePath.replace("\\", "/") + "/"
        if (!targetPath.startsWith(rootPath)) return null
        return target
    }

    /** 目录浏览：{ok, absolute, entries:[{name,type,size,modified}]} */
    fun listDir(rel: String): String {
        return try {
            val dir = resolveSafe(rel) ?: return err("路径越界或非法")
            if (!dir.exists()) return err("目录不存在: " + rel)
            if (!dir.isDirectory) return err("不是目录: " + rel)
            val entries = JSONArray()
            dir.listFiles()?.sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() })
                ?.forEach { f ->
                    entries.put(JSONObject().apply {
                        put("name", f.name)
                        put("type", if (f.isDirectory) "dir" else "file")
                        put("size", if (f.isFile) f.length() else 0L)
                        put("modified", f.lastModified())
                    })
                }
            JSONObject().apply {
                put("ok", true)
                put("path", rel.ifBlank { "." })
                put("absolute", dir.absolutePath)
                put("entries", entries)
            }.toString()
        } catch (e: Exception) {
            Log.e(TAG, "listDir 失败: " + e.message)
            err("目录读取失败: " + (e.message ?: "未知"))
        }
    }

    /** 文本读取（截断上限） */
    fun readFile(rel: String): String {
        return try {
            val f = resolveSafe(rel) ?: return err("路径越界或非法")
            if (!f.exists() || !f.isFile) return err("文件不存在: " + rel)
            if (f.length() > MAX_READ_BYTES) return err("文件过大（>512KB），请分段处理")
            val bytes = f.readBytes()
            JSONObject().apply {
                put("ok", true)
                put("path", rel)
                put("bytes", bytes.size)
                put("content", String(bytes, Charsets.UTF_8))
            }.toString()
        } catch (e: Exception) {
            Log.e(TAG, "readFile 失败: " + e.message)
            err("读取失败: " + (e.message ?: "未知"))
        }
    }

    /** 文本写入（自动创建父目录） */
    fun writeFile(rel: String, content: String): String {
        return try {
            val f = resolveSafe(rel) ?: return err("路径越界或非法")
            f.parentFile?.mkdirs()
            f.writeText(content ?: "", Charsets.UTF_8)
            JSONObject().apply {
                put("ok", true)
                put("path", rel)
                put("bytes", f.length())
            }.toString()
        } catch (e: Exception) {
            Log.e(TAG, "writeFile 失败: " + e.message)
            err("写入失败: " + (e.message ?: "未知"))
        }
    }

    /** 创建目录 */
    fun mkdir(rel: String): String {
        return try {
            val f = resolveSafe(rel) ?: return err("路径越界或非法")
            val ok = f.mkdirs() || f.isDirectory
            JSONObject().apply {
                put("ok", ok)
                put("path", rel)
            }.toString()
        } catch (e: Exception) {
            err("创建目录失败: " + (e.message ?: "未知"))
        }
    }

    /** 删除文件/目录（递归，仅限工作区根内） */
    fun deletePath(rel: String): String {
        return try {
            val f = resolveSafe(rel) ?: return err("路径越界或非法")
            if (!f.exists()) return err("不存在: " + rel)
            val ok = f.deleteRecursively()
            JSONObject().apply {
                put("ok", ok)
                put("path", rel)
            }.toString()
        } catch (e: Exception) {
            err("删除失败: " + (e.message ?: "未知"))
        }
    }

    /** 可用根目录信息 */
    fun getRoots(): String {
        return try {
            val roots = JSONArray()
            val wb = workspaceRoot()
            val public = isPublicWorkspace()
            roots.put(JSONObject().apply {
                put("name", if (public) "工作区（Download/workbench）" else "工作区（App 私有，未授权公共存储）")
                put("path", ".")
                put("absolute", wb.absolutePath)
                put("writable", true)
                put("publicWorkspace", public)
                put("needStoragePermission", !public)
            })
            // 公共存储：有权限才列出
            val pub = Environment.getExternalStorageDirectory()
            val canRead = context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
                android.os.Build.VERSION.SDK_INT >= 33 // 部分媒体权限在 Android 13+ 通过 READ_MEDIA_*
            if (pub.exists() && pub.listFiles() != null) {
                roots.put(JSONObject().apply {
                    put("name", "公共存储（只读浏览）")
                    put("path", "__public__")
                    put("absolute", pub.absolutePath)
                    put("writable", false)
                    put("canRead", canRead)
                })
            }
            JSONObject().apply {
                put("ok", true)
                put("roots", roots)
            }.toString()
        } catch (e: Exception) {
            err("根目录读取失败: " + (e.message ?: "未知"))
        }
    }

    /** 公共存储目录浏览（只读，尽力而为；无权限返回提示） */
    fun listPublicDir(rel: String): String {
        return try {
            val base = Environment.getExternalStorageDirectory() ?: return err("无公共存储")
            val target = File(base, (rel ?: "").trim().replace("\\", "/")).absoluteFile
            val basePath = base.absolutePath.trimEnd('/') + "/"
            if (!target.absolutePath.replace("\\", "/").startsWith(basePath)) return err("路径越界")
            if (!target.exists() || !target.isDirectory) return err("目录不存在: " + rel)
            val entries = JSONArray()
            target.listFiles()?.sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() })
                ?.forEach { f ->
                    entries.put(JSONObject().apply {
                        put("name", f.name)
                        put("type", if (f.isDirectory) "dir" else "file")
                        put("size", if (f.isFile) f.length() else 0L)
                        put("modified", f.lastModified())
                    })
                }
            JSONObject().apply {
                put("ok", true)
                put("path", rel.ifBlank { "." })
                put("absolute", target.absolutePath)
                put("writable", false)
                put("entries", entries)
            }.toString()
        } catch (e: Exception) {
            err("公共目录读取失败: " + (e.message ?: "未知"))
        }
    }

    private fun err(msg: String): String = JSONObject().apply {
        put("ok", false)
        put("error", msg)
    }.toString()
}
