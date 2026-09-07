# 宠物资源

每个子目录是一只可直接安装到 Desktop 的宠物包：

```text
pets/
  <pet-id>/
    pet.json
    spritesheet.webp
```

拉取仓库后，将一个宠物目录复制到本机数据目录即可：

```bash
cp -R pets/<pet-id> ~/.ai-usage/pets/
```

`<pet-id>` 必须与 `pet.json` 中的 `id` 相同。运行时只读取这两个文件：

- `pet.json`：`spriteVersionNumber` 固定为 `2`，`spritesheetPath` 固定为 `spritesheet.webp`。
- `spritesheet.webp`：1536×2288 的 WebP 图集，最大 12MB。

请勿在这里提交源文件、预览图或中间产物。每个 PR 只新增或修改一个 `pets/<pet-id>/` 包。
