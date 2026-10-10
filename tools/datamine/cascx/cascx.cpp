// cascx - minimal, strictly READ-ONLY CASC extractor built on CascLib (ladislav-zezula/CascLib).
//
// Usage:
//   cascx <storagePath> info
//   cascx <storagePath> list <mask> [<mask> ...]
//   cascx <storagePath> extract <outDir> <mask> [<mask> ...]
//   Options (anywhere): -k <keyfile>   import TACT keys ("KEYNAME KEYVALUE" per line, CascLib format)
//
// Safety: every CreateFile/CreateDirectory/MoveFileEx call made by CascLib is routed through
// wrappers below that strip write access, add full share flags (so the game/launcher is never
// locked out) and refuse any disposition other than OPEN_EXISTING. CascLib can therefore never
// create, modify, move or write-lock anything inside the game installation. Output files are
// written only by this program's own code, into <outDir>.

#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <filesystem>
#include <fstream>
#include <unordered_set>

// ---------------------------------------------------------------------------------------------
// Read-only guards for CascLib
static HANDLE WINAPI RO_CreateFileW(LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES sa,
                                    DWORD disposition, DWORD flags, HANDLE tmpl)
{
    if (disposition != OPEN_EXISTING) { SetLastError(ERROR_ACCESS_DENIED); return INVALID_HANDLE_VALUE; }
    const DWORD allowed = GENERIC_READ | FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_READ_EA | READ_CONTROL | SYNCHRONIZE;
    access &= allowed;
    if (access == 0) access = FILE_READ_DATA | FILE_READ_ATTRIBUTES;
    share |= FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    return CreateFileW(name, access, share, sa, OPEN_EXISTING, flags, tmpl);
}
static BOOL WINAPI RO_CreateDirectoryW(LPCWSTR, LPSECURITY_ATTRIBUTES) { SetLastError(ERROR_ACCESS_DENIED); return FALSE; }
static BOOL WINAPI RO_MoveFileExW(LPCWSTR, LPCWSTR, DWORD) { SetLastError(ERROR_ACCESS_DENIED); return FALSE; }

#undef CreateFile
#undef CreateDirectory
#undef MoveFileEx
#define CreateFile       RO_CreateFileW
#define CreateDirectory  RO_CreateDirectoryW
#define MoveFileEx       RO_MoveFileExW

// Unity build of CascLib (sources are referenced from the vendor dir via -I, never modified)
#include "src/common/Common.cpp"
#include "src/common/Csv.cpp"
#include "src/common/Directory.cpp"
#include "src/common/FileStream.cpp"
#include "src/common/FileTree.cpp"
#include "src/common/ListFile.cpp"
#include "src/common/Mime.cpp"
#include "src/common/RootHandler.cpp"
#include "src/common/Sockets.cpp"
#include "src/hashes/md5.cpp"
#include "src/hashes/sha1.cpp"
#include "src/overwatch/aes.cpp"
#include "src/overwatch/apm.cpp"
#include "src/overwatch/cmf.cpp"
#include "src/CascDecompress.cpp"
#include "src/CascDecrypt.cpp"
#include "src/CascDumpData.cpp"
#include "src/CascFiles.cpp"
#include "src/CascFindFile.cpp"
#include "src/CascIndexFiles.cpp"
#include "src/CascOpenFile.cpp"
#include "src/CascOpenStorage.cpp"
#include "src/CascReadFile.cpp"
#include "src/CascRootFile_Diablo3.cpp"
#include "src/CascRootFile_Install.cpp"
#include "src/CascRootFile_MNDX.cpp"
#include "src/CascRootFile_OW.cpp"
#include "src/CascRootFile_Text.cpp"
#include "src/CascRootFile_TVFS.cpp"
#include "src/CascRootFile_WoW.cpp"

#undef CreateFile
#undef CreateDirectory
#undef MoveFileEx

// ---------------------------------------------------------------------------------------------
extern "C" int _dowildcard = 0;   // disable mingw argv globbing

static std::wstring widen(const char* s)
{
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    std::wstring w(n ? n - 1 : 0, L'\0');
    if (n) MultiByteToWideChar(CP_UTF8, 0, s, -1, &w[0], n);
    return w;
}

static bool WildMatch(const char* mask, const char* name)
{
    // Case-insensitive glob: '*' any sequence (including separators), '?' single char.
    const char *m = mask, *n = name, *star = NULL, *ss = NULL;
    while (*n) {
        if (*m == '?' || (tolower((unsigned char)*m) == tolower((unsigned char)*n)) ||
            ((*m == '\\' || *m == '/' || *m == ':') && (*n == '\\' || *n == '/' || *n == ':'))) { m++; n++; continue; }
        if (*m == '*') { star = m++; ss = n; continue; }
        if (star) { m = star + 1; n = ++ss; continue; }
        return false;
    }
    while (*m == '*') m++;
    return *m == 0;
}

static int Usage()
{
    fprintf(stderr, "usage: cascx <storage> info | list <mask...> | extract <outDir> <mask...> | extract-list <outDir> <listFile>  [-k keyfile]\n");
    return 2;
}

int main(int argc, char** argv)
{
    std::vector<std::string> args;
    std::string keyFile;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-k") && i + 1 < argc) { keyFile = argv[++i]; continue; }
        args.push_back(argv[i]);
    }
    if (args.size() < 2) return Usage();

    std::wstring storage = widen(args[0].c_str());
    std::string cmd = args[1];

    HANDLE hStorage = NULL;
    if (!CascOpenStorage(storage.c_str(), 0, &hStorage)) {
        fprintf(stderr, "CascOpenStorage failed: %u\n", (unsigned)GetCascError());
        return 1;
    }
    if (!keyFile.empty()) {
        if (!CascImportKeysFromFile(hStorage, widen(keyFile.c_str()).c_str()))
            fprintf(stderr, "warning: key import failed (%u)\n", (unsigned)GetCascError());
    }

    if (cmd == "info") {
        CASC_STORAGE_PRODUCT prod = {};
        CascGetStorageInfo(hStorage, CascStorageProduct, &prod, sizeof(prod), NULL);
        DWORD total = 0, local = 0, features = 0;
        CascGetStorageInfo(hStorage, CascStorageTotalFileCount, &total, sizeof(total), NULL);
        CascGetStorageInfo(hStorage, CascStorageLocalFileCount, &local, sizeof(local), NULL);
        CascGetStorageInfo(hStorage, CascStorageFeatures, &features, sizeof(features), NULL);
        printf("product=%s build=%u total=%u local=%u features=0x%x\n", prod.szCodeName, (unsigned)prod.BuildNumber,
               (unsigned)total, (unsigned)local, (unsigned)features);
        CascCloseStorage(hStorage);
        return 0;
    }

    // extract-list <outDir> <listFile>: exact storage names, one per line (fast path for many files)
    bool useList = (cmd == "extract-list");
    bool doExtract = (cmd == "extract") || useList;
    if (!doExtract && cmd != "list") return Usage();
    size_t firstMask = doExtract ? 3 : 2;
    if (args.size() <= firstMask) return Usage();
    std::unordered_set<std::string> wanted;
    if (useList) {
        std::ifstream lf(std::filesystem::path(widen(args[3].c_str())));
        std::string line;
        while (std::getline(lf, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
            if (!line.empty()) wanted.insert(line);
        }
        fprintf(stderr, "wanted=%zu\n", wanted.size());
    }
    std::filesystem::path outDir = doExtract ? std::filesystem::path(widen(args[2].c_str())) : std::filesystem::path();

    std::vector<BYTE> buffer;
    unsigned matched = 0, extracted = 0, failed = 0;
    CASC_FIND_DATA fd;
    HANDLE hFind = CascFindFirstFile(hStorage, "*", &fd, NULL);
    if (hFind == NULL || hFind == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "CascFindFirstFile failed: %u\n", (unsigned)GetCascError());
        CascCloseStorage(hStorage);
        return 1;
    }
    do {
        bool hit = useList && wanted.count(fd.szFileName) != 0;
        for (size_t i = firstMask; !useList && i < args.size() && !hit; i++) hit = WildMatch(args[i].c_str(), fd.szFileName);
        if (!hit) continue;
        matched++;
        if (!doExtract) {
            printf("%s\t%llu\t%u\n", fd.szFileName, (unsigned long long)fd.FileSize, (unsigned)fd.bFileAvailable);
            continue;
        }
        HANDLE hFile = NULL;
        if (!CascOpenFile(hStorage, fd.szFileName, 0, CASC_OPEN_BY_NAME, &hFile)) {
            fprintf(stderr, "open failed (%u): %s\n", (unsigned)GetCascError(), fd.szFileName); failed++; continue;
        }
        ULONGLONG size = 0;
        CascGetFileSize64(hFile, &size);
        buffer.resize((size_t)size);
        DWORD got = 0; bool ok = true; size_t pos = 0;
        while (pos < size) {
            DWORD chunk = (DWORD)((size - pos) > 0x10000000 ? 0x10000000 : (size - pos));
            if (!CascReadFile(hFile, buffer.data() + pos, chunk, &got) || got == 0) { ok = false; break; }
            pos += got;
        }
        DWORD err = GetCascError();
        CascCloseFile(hFile);
        if (!ok) { fprintf(stderr, "read failed (%u) at %zu/%llu: %s\n", (unsigned)err, pos, (unsigned long long)size, fd.szFileName); failed++; continue; }

        std::string rel = fd.szFileName;
        for (char& c : rel) if (c == ':' || c == '\\') c = '/';
        std::filesystem::path out = outDir / std::filesystem::path(widen(rel.c_str()));
        std::error_code ec;
        std::filesystem::create_directories(out.parent_path(), ec);
        std::ofstream f(out, std::ios::binary | std::ios::trunc);
        if (!f) { fprintf(stderr, "cannot write %s\n", rel.c_str()); failed++; continue; }
        f.write((const char*)buffer.data(), (std::streamsize)pos);
        extracted++;
    } while (CascFindNextFile(hFind, &fd));
    CascFindClose(hFind);
    CascCloseStorage(hStorage);
    fprintf(stderr, "matched=%u extracted=%u failed=%u\n", matched, extracted, failed);
    return failed ? 3 : 0;
}
