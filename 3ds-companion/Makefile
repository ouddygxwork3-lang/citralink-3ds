#---------------------------------------------------------------------------------
# CitraLink 3DS Direct — devkitARM + libctru + makerom Makefile
# Targets:
#   make      -> builds .3dsx + .smdh for Homebrew Launcher
#   make cia  -> builds installable .cia for Nintendo 3DS HOME Menu
#---------------------------------------------------------------------------------
.SUFFIXES:

ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM in your environment. export DEVKITARM=<path to>devkitARM")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITARM)/3ds_rules

TARGET       := CitraLink_3DS_Direct
BUILD        := build
SOURCES      := source
DATA         := data
INCLUDES     := include

APP_TITLE    := CitraLink 3DS Direct
APP_DESCRIPTION := Wireless CIA Stream Installer & Direct Save Sync
APP_AUTHOR   := CitraLink 3DS Project
PRODUCT_CODE := CTR-P-CLNK
UNIQUE_ID    := 0xEC73D

ARCH         := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS       := -g -Wall -O2 -mword-relocations -ffunction-sections $(ARCH) -D__3DS__
CXXFLAGS     := $(CFLAGS) -fno-rtti -fno-exceptions -std=gnu++11
ASFLAGS      := -g $(ARCH)
LDFLAGS      := -specs=3dsx.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)
LIBS         := -lctru -lm

ifneq ($(BUILD),$(notdir $(CURDIR)))

export OUTPUT   := $(CURDIR)/$(TARGET)
export TOPDIR   := $(CURDIR)
export VPATH    := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR  := $(CURDIR)/$(BUILD)

CFILES   := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
export OFILES := $(CFILES:.c=.o)
export INCLUDE := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) -I$(CURDIR)/$(BUILD) -I$(DEVKITPRO)/libctru/include
export LIBPATHS := -L$(DEVKITPRO)/libctru/lib

.PHONY: $(BUILD) clean cia all

all: $(BUILD)

$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

cia: $(BUILD)
	@echo "Building HOME Menu Installable Archive: $(TARGET).cia"
	@makerom -f cia -o $(TARGET).cia \
		-DAPP_ENCRYPTED=false \
		-rsf $(CURDIR)/app.rsf \
		-target t -exefslogo \
		-elf $(BUILD)/$(TARGET).elf \
		-icon $(BUILD)/$(TARGET).smdh

clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).3dsx $(TARGET).smdh $(TARGET).elf $(TARGET).cia

else

DEPENDS := $(OFILES:.o=.d)

.PHONY: all

all: $(OUTPUT).3dsx

$(OUTPUT).3dsx : $(OUTPUT).elf $(OUTPUT).smdh

$(OUTPUT).elf  : $(OFILES)

-include $(DEPENDS)

endif
