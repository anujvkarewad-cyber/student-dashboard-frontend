"""Bound CI memory and fail promptly on OOM; preserve signing properties verbatim."""
from pathlib import Path
import sys
SETTINGS={
 'org.gradle.jvmargs':'-Xmx3072m -XX:MaxMetaspaceSize=1536m -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8',
 'org.gradle.workers.max':'2',
 'org.gradle.parallel':'false',
 'kotlin.compiler.execution.strategy':'in-process',
}
def configure(text):
    lines=[line for line in text.splitlines() if line.split('=',1)[0].strip() not in SETTINGS]
    return '\n'.join(lines)+'\n'+''.join(f'{k}={v}\n' for k,v in SETTINGS.items())
def main():
    p=Path(sys.argv[1]);p.write_text(configure(p.read_text()))
    print('CI Gradle: heap3072MiB, metaspace1536MiB, workers2, Kotlin in-process; OOM exits promptly. No signing values printed.')
if __name__=='__main__':main()
